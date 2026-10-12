# =============================================================================
# legacy.rb — Comandos "crudos" originales (vista Avanzado): abrir, listar
# campos, editar una hoja, guardar... Reusan edit_rxdata.rb (RxDocument,
# Collector, TypeOracle, UI, save_document) sin modificarlo.
# =============================================================================

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

def load_document!(path)
  raise DriverError.new('FileNotFound', "no se encontro '#{path}'") unless path && File.file?(path)

  RxDocument.parse(File.binread(path))
rescue RxMarshal::FormatError => e
  raise DriverError.new('FormatError', e.message)
end

# ── Edicion de hojas ────────────────────────────────────────────────────────

# Toda edicion cruda pasa por el Journal (como una Op reversible), asi el
# deshacer, el panel de cambios y el guardado funcionan igual que en las
# vistas semanticas.
def raw_label(f)
  { key: 'op.raw', params: { path: f.path } }
end

def apply_leaf(session, f, old_val, new_val)
  session.journal.transaction(raw_label(f)) do |b|
    b.apply(Sem::SetSlot.new(Sem::Slot.from_field(f), new_val))
  end
  session.semantic&.invalidate_coverage!
  { applied: true, old: value_summary(old_val), new: value_summary(new_val),
    pendingCount: session.journal.pending_count, structuralRebuild: false }
end

def apply_structural(session, f, old_val, new_val)
  session.journal.transaction(raw_label(f)) do |b|
    b.apply(Sem::SetSlot.new(Sem::Slot.from_field(f), new_val, structural: true))
  end
  session.rebuild_collector!
  session.semantic&.invalidate_coverage!
  { applied: true, old: value_summary(old_val), new: value_summary(new_val),
    pendingCount: session.journal.pending_count, structuralRebuild: true,
    newFieldCount: session.collector.fields.size }
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
  return { applied: false, needsTemplateChoice: true, class: cls, instances: template_list(list) } if slot_arg.nil?

  i = slot_arg.to_i - 1
  raise DriverError.new('InvalidTemplateSlot', 'Opcion invalida.') unless i >= 0 && i < cap

  new_val = RxMarshal.deep_clone(list[i][0])
  apply_structural(session, f, old_val, new_val)
end

# ── Comandos ─────────────────────────────────────────────────────────────────

Commands.register('ping', needs_session: false) { |_ctx, _p| { pong: true } }

Commands.register('check', needs_session: false) do |_ctx, params|
  doc = load_document!(params['path'])
  diff = doc.roundtrip_diff
  { roots: doc.roots.size, wrapper: doc.wrapper.to_s, roundtripClean: diff.nil?, diffByte: diff }
end

Commands.register('open', needs_session: false) do |ctx, params|
  path = params['path']
  doc = load_document!(path)

  script_paths = Array(params['scripts']).map(&:to_s)
  autodetect = params.key?('autodetect') ? !!params['autodetect'] : true
  if script_paths.empty? && autodetect
    root = ScriptIndex.autodetect(path)
    script_paths << root if root
  end
  page_size = (params['pageSize'] || 100).to_i
  page_size = 20 if page_size < 1

  session = Session.new(doc: doc, file_path: path, output_path: path, page_size: page_size,
                        script_paths: script_paths)
  ctx.session = session

  data = { roots: doc.roots.size, wrapper: doc.wrapper.to_s, fileSize: File.size(path),
           indexState: 'idle', roundtripChecked: false }
  data.merge!(Sem::Api.open_payload(session)) if defined?(Sem::Api)
  data
end

# Verificacion perezosa del roundtrip (la UI la pide justo despues de abrir).
Commands.register('verify_roundtrip') do |ctx, _p|
  diff = ctx.session.roundtrip_diff
  { roundtripClean: diff.nil?, diffByte: diff, roots: ctx.session.doc.roots.size,
    wrapper: ctx.session.doc.wrapper.to_s }
end

Commands.register('close', needs_session: false) do |ctx, _p|
  ctx.session = nil
  { closed: true }
end

Commands.register('shutdown', needs_session: false) do |ctx, _p|
  ctx.shutdown = true
  { shuttingDown: true }
end

# Estado del indice de campos (Collector): `idle` hasta que alguien lo pida.
Commands.register('index_status') { |ctx, _p| ctx.session.index_counts }

# Construye el indice (puede tardar varios segundos en saves grandes).
Commands.register('build_index') do |ctx, _p|
  ctx.session.ensure_index!
  ctx.session.index_counts.merge(scripts: ctx.session.script_report)
end

Commands.register('list_fields') do |ctx, params|
  session = ctx.session
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
    pendingCount: session.journal.pending_count, fields: rows }
end

Commands.register('get_field') do |ctx, params|
  session = ctx.session
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

Commands.register('list_templates') do |ctx, params|
  cls = params['className'].to_s
  list = ctx.session.collector.instances.fetch(cls, [])
  { class: cls, instances: template_list(list) }
end

Commands.register('set_field', mutates: true) do |ctx, params|
  session = ctx.session
  index = params['index'].to_i
  f = field_at!(session, index)
  confirmed = !!params['confirmed']
  raw = params['input'].to_s

  old = f.get
  cur_t = RxMarshal.type_desc(old)
  res = session.oracle.infer(f)

  next { applied: false, reason: 'empty' } if raw.empty?
  next { applied: false, reason: 'cancelled' } if raw.downcase == 'cancelar'

  case raw
  when '[]'
    next apply_structural(session, f, old, RxMarshal::RxArr.new([]))
  when '{}'
    next apply_structural(session, f, old, RxMarshal::RxHash.new([]))
  end
  if raw =~ /\A(copiar|clonar|plantilla)(?:\s+(\S+))?(?:\s+(\d+))?\z/i
    next set_field_from_template(session, f, old, res, Regexp.last_match(2), Regexp.last_match(3))
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
    next { applied: false, needsConfirmation: true, reason: 'override_high_confidence',
           message: "El tipo inferido es #{res.best.type} (confianza alta). Guardar como #{type} igual?",
           inferredType: res.best.type, proposedType: type }
  elsif !old.nil? && explicit && type != 'nil' && type != cur_t && !confirmed
    next { applied: false, needsConfirmation: true, reason: 'type_change',
           message: "Cambiar el tipo de #{cur_t} a #{type}?", currentType: cur_t, proposedType: type }
  end

  begin
    new_val = UI.build_value(session.doc, type, value, old)
  rescue EncodingError => e
    raise DriverError.new('EncodingError', "No se puede codificar ese texto: #{e.message}")
  end

  next { applied: false, reason: 'same_value' } if UI.same_value?(new_val, old)

  apply_leaf(session, f, old, new_val)
end

# Cambios pendientes: una entrada por Op, de la transaccion mas reciente a la mas antigua.
Commands.register('list_changes') do |ctx, _p|
  txs = ctx.session.journal.undo_stack.reverse
  changes = txs.flat_map do |tx|
    tx.ops.map { |op| op.describe.merge(txId: tx.id, label: tx.label) }
  end
  { count: txs.size, opCount: changes.size, changes: changes,
    redoCount: ctx.session.journal.redo_stack.size }
end

Commands.register('nil_report') do |ctx, _p|
  session = ctx.session
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

Commands.register('save') do |ctx, params|
  session = ctx.session
  backup = params.key?('backup') ? !!params['backup'] : true
  confirmed = !!params['confirmed']

  next { applied: false, reason: 'no_changes' } unless session.dirty?

  if session.roundtrip_diff && !confirmed
    next { applied: false, needsConfirmation: true, reason: 'roundtrip_diff',
           message: 'Este archivo no se reconstruye identico byte a byte.' }
  end

  # Validacion previa de las entidades editadas (limites blandos).
  if session.semantic
    issues = Sem::Validator.validate_refs(session.semantic.model, session.journal.touched_refs)
    blocking = Sem::Validator.blocking(issues)
    unless blocking.empty? || confirmed
      next { applied: false, needsConfirmation: true, reason: 'validation', issues: issues }
    end
  end

  begin
    bytes_size, bak_path = save_document(session.doc, session.output_path, backup)
  rescue StandardError => e
    raise DriverError.new('SaveError', e.message)
  end

  changes_applied = session.journal.pending_count
  session.journal.clear!
  { applied: true, bytesWritten: bytes_size, backupPath: bak_path, changesApplied: changes_applied }
end
