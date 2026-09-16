#!/usr/bin/env ruby
# =============================================================================
# rxdata_driver.rb — Protocolo JSON por linea (stdin/stdout) sobre edit_rxdata.rb
#
# No modifica edit_rxdata.rb: lo requiere como libreria (su "main" esta
# protegido con `main if $PROGRAM_NAME == __FILE__`, asi que este require no
# dispara el REPL) y reusa sus clases (RxDocument, Collector, TypeOracle, UI,
# RxMarshal, save_document, nil_report) para no duplicar logica ya validada.
#
# Protocolo: una peticion JSON por linea de entrada -> exactamente una
# respuesta JSON por linea de salida, en el mismo orden (nunca hay dos
# comandos en vuelo a la vez). Peticion: {"id":N,"cmd":"...", ...params}.
# Respuesta: {"id":N,"ok":true,...} o {"id":N,"ok":false,"error":{...}}.
# Los backtraces van a stderr (edit_rxdata.rb nunca lo usa), nunca a stdout,
# para que el stream de JSON no se rompa nunca.
# =============================================================================

require 'json'
require_relative '../edit_rxdata.rb'

C.disable!
$stdin.set_encoding(Encoding::UTF_8, Encoding::UTF_8)
$stdout.set_encoding(Encoding::UTF_8, Encoding::UTF_8)
$stdout.sync = true

class DriverError < StandardError
  attr_reader :error_type

  def initialize(error_type, message)
    super(message)
    @error_type = error_type
  end
end

class Session
  attr_accessor :doc, :collector, :oracle, :scripts, :file_path, :output_path, :page_size, :roundtrip_diff, :changed

  def initialize(doc:, collector:, oracle:, scripts:, file_path:, output_path:, page_size:, roundtrip_diff:)
    @doc = doc
    @collector = collector
    @oracle = oracle
    @scripts = scripts
    @file_path = file_path
    @output_path = output_path
    @page_size = page_size
    @roundtrip_diff = roundtrip_diff
    @changed = {}
  end

  # Espeja el rebuild que hace el REPL tras una edicion estructural
  # ([]/{}/copiar): insertar o reemplazar un array/objeto cambia la cantidad
  # e identidad de todos los campos hijo, asi que hay que recolectar de nuevo.
  def rebuild_collector!
    @collector = Collector.new(@doc).run
    @oracle.reset!(@collector)
  end
end

# ── Serializacion de valores ────────────────────────────────────────────────

def value_summary(v, max = 300)
  case v
  when nil
    { kind: 'nil', display: 'nil' }
  when true, false
    { kind: 'bool', display: v.to_s, value: v }
  when Integer
    { kind: 'int', display: v.to_s, value: v }
  when RxMarshal::RxBig
    { kind: 'int', display: v.value.to_s, value: v.value }
  when RxMarshal::RxFloat
    fv = v.value
    if fv.finite?
      { kind: 'float', display: fv.to_s, value: fv }
    else
      special = fv.nan? ? 'nan' : (fv.positive? ? 'inf' : '-inf')
      { kind: 'float', display: special, special: special }
    end
  when RxMarshal::RxSym
    { kind: 'sym', display: ":#{v.name}", value: v.name }
  when RxMarshal::RxStr
    text = v.text
    truncated = text.length > max
    shown = truncated ? text[0, max] : text
    { kind: 'str', display: RxMarshal.quote(shown) + (truncated ? '...' : ''), value: shown,
      truncated: truncated, fullLength: text.length }
  when RxMarshal::RxArr
    { kind: 'array', display: "[array con #{v.items.size} elemento(s)]", count: v.items.size }
  when RxMarshal::RxHash
    { kind: 'hash', display: "{hash con #{v.pairs.size} par(es)}", count: v.pairs.size }
  when RxMarshal::Node
    t = RxMarshal.type_desc(v)
    { kind: t, display: "#<#{t.sub('obj:', '')}>" }
  else
    { kind: 'desconocido', display: v.inspect }
  end
end

def inference_summary(res, limit = 6)
  return { confidence: nil, candidates: [] } if res.nil? || res.best.nil?

  total = res.candidates.sum(&:score)
  {
    confidence: res.confidence,
    candidates: res.candidates.first(limit).map do |c|
      { type: c.type, scorePct: total.positive? ? (100.0 * c.score / total).round : 0, evidence: c.evidence }
    end
  }
end

def field_row(f, idx, oracle)
  v = f.get
  row = { index: idx, path: f.path, type: RxMarshal.type_desc(v), nil: v.nil? }
  if v.nil?
    res = oracle.infer(f)
    row[:inferred] = { type: res.best.type, confidence: res.confidence } if res.best
  else
    row[:value] = value_summary(v)
  end
  row
end

def template_list(list)
  list.first(8).each_with_index.map { |(_, path), i| { slot: i, path: path } }
end

def field_at!(session, index)
  f = session.collector.fields[index]
  raise DriverError.new('FieldNotFound', "indice de campo invalido: #{index.inspect}") unless f

  f
end

# ── Comandos ─────────────────────────────────────────────────────────────────

def cmd_check(params)
  path = params['path']
  raise DriverError.new('FileNotFound', "no se encontro '#{path}'") unless path && File.file?(path)

  begin
    doc = RxDocument.parse(File.binread(path))
  rescue RxMarshal::FormatError => e
    raise DriverError.new('FormatError', e.message)
  end
  diff = doc.roundtrip_diff
  { roots: doc.roots.size, wrapper: doc.wrapper.to_s, roundtripClean: diff.nil?, diffByte: diff }
end

def cmd_open(params)
  path = params['path']
  raise DriverError.new('FileNotFound', "no se encontro '#{path}'") unless path && File.file?(path)

  script_paths = Array(params['scripts']).map(&:to_s)
  autodetect = params.key?('autodetect') ? !!params['autodetect'] : true
  page_size = (params['pageSize'] || 100).to_i
  page_size = 20 if page_size < 1

  begin
    doc = RxDocument.parse(File.binread(path))
  rescue RxMarshal::FormatError => e
    raise DriverError.new('FormatError', e.message)
  end
  diff = doc.roundtrip_diff

  if script_paths.empty? && autodetect
    root = ScriptIndex.autodetect(path)
    script_paths << root if root
  end

  scripts = nil
  script_report = { filesScanned: 0, hints: 0, fallbackFiles: 0, rootsUsed: [], errors: [] }
  unless script_paths.empty?
    scripts = ScriptIndex.new
    script_paths.each { |p| scripts.add_path(p) }
    script_report = { filesScanned: scripts.files, hints: scripts.hint_total, fallbackFiles: scripts.fallback_files,
                       rootsUsed: scripts.roots_used, errors: scripts.errors.first(5) }
  end

  collector = Collector.new(doc).run
  oracle = TypeOracle.new(collector, scripts)
  nil_count = collector.fields.count { |f| f.get.nil? }

  session = Session.new(doc: doc, collector: collector, oracle: oracle, scripts: scripts, file_path: path,
                         output_path: path, page_size: page_size, roundtrip_diff: diff)

  data = { roots: doc.roots.size, wrapper: doc.wrapper.to_s, roundtripClean: diff.nil?, diffByte: diff,
           fieldCount: collector.fields.size, nilCount: nil_count, scripts: script_report }
  [data, session]
end

def cmd_list_fields(session, params)
  filter_path = (params['filterPath'] || '').to_s
  filter_type = params['filterType']
  page = (params['page'] || 0).to_i
  page = 0 if page.negative?
  page_size = (params['pageSize'] || session.page_size).to_i
  page_size = 1 if page_size < 1

  pairs = session.collector.fields.each_with_index.to_a
  unless filter_path.empty?
    q = filter_path.downcase
    pairs = pairs.select { |f, _| f.path.downcase.include?(q) }
  end
  if filter_type && !filter_type.to_s.empty?
    pairs = pairs.select { |f, _| UI.type_match?(f, filter_type, session.oracle) }
  end

  total = pairs.size
  total_pages = total.zero? ? 0 : ((total - 1) / page_size) + 1
  page_pairs = pairs[page * page_size, page_size] || []
  rows = page_pairs.map { |f, idx| field_row(f, idx, session.oracle) }

  { total: total, totalPages: total_pages, page: page, pageSize: page_size,
    pendingCount: session.changed.size, fields: rows }
end

def cmd_get_field(session, params)
  index = params['index'].to_i
  f = field_at!(session, index)
  v = f.get
  res = session.oracle.infer(f)

  data = { index: index, path: f.path, slotKeys: f.keys, type: RxMarshal.type_desc(v), nil: v.nil? }
  data[:value] = value_summary(v) unless v.nil?
  data[:nilInference] = inference_summary(res) if v.nil?

  objs = res.candidates.map(&:type).select { |t| t.start_with?('obj:') }
  data[:templates] = objs.map do |t|
    cls = t.sub('obj:', '')
    n = session.collector.instances.fetch(cls, []).size
    { class: cls, count: n, truncated: n >= 12 }
  end
  data
end

def cmd_list_templates(session, params)
  cls = params['className'].to_s
  list = session.collector.instances.fetch(cls, [])
  { class: cls, instances: template_list(list) }
end

def apply_leaf(session, f, old_val, new_val)
  f.set(new_val)
  record_change(session, f, old_val, new_val)
  { applied: true, old: value_summary(old_val), new: value_summary(new_val),
    pendingCount: session.changed.size, structuralRebuild: false }
end

def apply_structural(session, f, old_val, new_val)
  f.set(new_val)
  record_change(session, f, old_val, new_val)
  session.rebuild_collector!
  { applied: true, old: value_summary(old_val), new: value_summary(new_val),
    pendingCount: session.changed.size, structuralRebuild: true, newFieldCount: session.collector.fields.size }
end

def record_change(session, f, old_val, new_val)
  if session.changed.key?(f.path)
    session.changed[f.path][:new] = new_val
    session.changed.delete(f.path) if UI.same_value?(session.changed[f.path][:old], new_val)
  else
    session.changed[f.path] = { old: old_val, new: new_val }
  end
end

def set_field_from_template(session, f, old_val, res, cls_arg, slot_arg)
  classes = if cls_arg && !cls_arg.empty?
              [cls_arg]
            else
              res.candidates.map(&:type).select { |t| t.start_with?('obj:') }.map { |t| t.sub('obj:', '') }
            end
  cls = classes.find { |c| !session.collector.instances.fetch(c, []).empty? }
  unless cls
    wanted = classes.empty? ? 'ningun objeto' : classes.join(', ')
    raise DriverError.new('NoTemplateAvailable',
                           "No hay instancias de #{wanted} en la partida para usar como plantilla.")
  end

  list = session.collector.instances[cls]
  cap = [list.size, 8].min
  if slot_arg.nil?
    return { applied: false, needsTemplateChoice: true, class: cls, instances: template_list(list) }
  end

  i = slot_arg.to_i - 1
  raise DriverError.new('InvalidTemplateSlot', 'Opcion invalida.') unless i >= 0 && i < cap

  new_val = RxMarshal.deep_clone(list[i][0])
  apply_structural(session, f, old_val, new_val)
end

def cmd_set_field(session, params)
  index = params['index'].to_i
  f = field_at!(session, index)
  confirmed = !!params['confirmed']
  raw = params['input'].to_s

  old = f.get
  cur_t = RxMarshal.type_desc(old)
  res = session.oracle.infer(f)

  return { applied: false, reason: 'empty' } if raw.empty?
  return { applied: false, reason: 'cancelled' } if raw.downcase == 'cancelar'

  case raw
  when '[]'
    return apply_structural(session, f, old, RxMarshal::RxArr.new([]))
  when '{}'
    return apply_structural(session, f, old, RxMarshal::RxHash.new([]))
  end
  if raw =~ /\A(copiar|clonar|plantilla)(?:\s+(\S+))?(?:\s+(\d+))?\z/i
    return set_field_from_template(session, f, old, res, Regexp.last_match(2), Regexp.last_match(3))
  end

  explicit = false
  if raw =~ /\A([a-zA-Z]+):(.*)\z/m && UI::TYPE_ALIASES.key?(Regexp.last_match(1).downcase)
    type = UI::TYPE_ALIASES[Regexp.last_match(1).downcase]
    text = Regexp.last_match(2).strip
    explicit = true
  elsif raw.downcase == 'nil'
    type = 'nil'
    text = raw
    explicit = true
  elsif !old.nil?
    type = cur_t
    text = raw
    raise DriverError.new('NotEditable', 'Este campo no es editable como texto.') unless UI::EDITABLE.include?(type)
  elsif res.best && UI::EDITABLE.include?(res.best.type)
    type = res.best.type
    text = raw
  elsif res.best
    raise DriverError.new('NoTypeHint',
                           "El tipo inferido es #{res.best.type}: usa 'copiar' (objeto), '[]' o '{}', " \
                           'o fuerza otro tipo con prefijo (ej. int:5, str:hola).')
  else
    type = UI.guess_input_type(raw)
    text = raw
  end

  begin
    value = UI.parse_as(type, text)
  rescue RuntimeError => e
    raise DriverError.new('ValidationError', e.message)
  end

  if old.nil? && type != 'nil' && res.best && res.best.type != type && res.confidence == :alta && !confirmed
    return { applied: false, needsConfirmation: true, reason: 'override_high_confidence',
             message: "El tipo inferido es #{res.best.type} (confianza alta). Guardar como #{type} igual?",
             inferredType: res.best.type, proposedType: type }
  elsif !old.nil? && explicit && type != 'nil' && type != cur_t && !confirmed
    return { applied: false, needsConfirmation: true, reason: 'type_change',
             message: "Cambiar el tipo de #{cur_t} a #{type}?", currentType: cur_t, proposedType: type }
  end

  begin
    new_val = UI.build_value(session.doc, type, value, old)
  rescue EncodingError => e
    raise DriverError.new('EncodingError', "No se puede codificar ese texto: #{e.message}")
  end

  return { applied: false, reason: 'same_value' } if UI.same_value?(new_val, old)

  apply_leaf(session, f, old, new_val)
end

def cmd_list_changes(session)
  changes = session.changed.map do |path, h|
    { path: path, old: value_summary(h[:old]), new: value_summary(h[:new]) }
  end
  { count: changes.size, changes: changes }
end

def cmd_nil_report(session)
  groups = session.collector.nil_fields.group_by { |f| f.keys.last }
  counts = Hash.new(0)
  rows = groups.sort_by { |key, _| key }.map do |key, fs|
    res = session.oracle.infer(fs.first)
    best = res.best
    counts[res.confidence || :sin] += fs.size
    { slotKey: key, count: fs.size, inferredType: best&.type, confidence: res.confidence,
      topEvidence: best&.evidence&.first }
  end
  { groups: rows, summary: { alta: counts[:alta], media: counts[:media], baja: counts[:baja], sin: counts[:sin] } }
end

def cmd_save(session, params)
  backup = params.key?('backup') ? !!params['backup'] : true
  confirmed = !!params['confirmed']

  return { applied: false, reason: 'no_changes' } if session.changed.empty?

  if session.roundtrip_diff && !confirmed
    return { applied: false, needsConfirmation: true, reason: 'roundtrip_diff',
             message: 'Este archivo no se reconstruye identico byte a byte.' }
  end

  begin
    bytes_size, bak_path = save_document(session.doc, session.output_path, backup)
  rescue StandardError => e
    raise DriverError.new('SaveError', e.message)
  end

  changes_applied = session.changed.size
  session.changed.clear
  { applied: true, bytesWritten: bytes_size, backupPath: bak_path, changesApplied: changes_applied }
end

# ── Bucle principal ──────────────────────────────────────────────────────────

def write_json(obj)
  $stdout.write(JSON.generate(obj))
  $stdout.write("\n")
end

def ok_response(id, data = {})
  write_json({ id: id, ok: true }.merge(data))
end

def err_response(id, type, message)
  write_json({ id: id, ok: false, error: { type: type, message: message } })
end

def require_session!(session)
  raise DriverError.new('NoSessionOpen', 'No hay ningun archivo abierto. Usa "open" primero.') if session.nil?
end

def run
  session = nil

  while (line = $stdin.gets)
    line = line.strip
    next if line.empty?

    id = nil
    begin
      req = JSON.parse(line)
      id = req['id']
      cmd = req['cmd']

      case cmd
      when 'ping'
        ok_response(id, pong: true)
      when 'check'
        ok_response(id, cmd_check(req))
      when 'open'
        data, new_session = cmd_open(req)
        session = new_session
        ok_response(id, data)
      when 'list_fields'
        require_session!(session)
        ok_response(id, cmd_list_fields(session, req))
      when 'get_field'
        require_session!(session)
        ok_response(id, cmd_get_field(session, req))
      when 'list_templates'
        require_session!(session)
        ok_response(id, cmd_list_templates(session, req))
      when 'set_field'
        require_session!(session)
        ok_response(id, cmd_set_field(session, req))
      when 'list_changes'
        require_session!(session)
        ok_response(id, cmd_list_changes(session))
      when 'nil_report'
        require_session!(session)
        ok_response(id, cmd_nil_report(session))
      when 'save'
        require_session!(session)
        ok_response(id, cmd_save(session, req))
      when 'close'
        session = nil
        ok_response(id, closed: true)
      when 'shutdown'
        ok_response(id, shuttingDown: true)
        break
      else
        err_response(id, 'ProtocolError', "comando desconocido: #{cmd.inspect}")
      end
    rescue JSON::ParserError => e
      err_response(id, 'ProtocolError', "JSON invalido: #{e.message}")
    rescue DriverError => e
      err_response(id, e.error_type, e.message)
    rescue RxMarshal::FormatError => e
      err_response(id, 'FormatError', e.message)
    rescue StandardError => e
      err_response(id, 'InternalError', "#{e.class}: #{e.message}")
      warn e.backtrace.join("\n") if ENV['RXDATA_DRIVER_DEBUG']
    end
  end
end

begin
  run
rescue Interrupt, Errno::EPIPE
  exit 0
end
