# =============================================================================
# diff.rb — Copias de seguridad (listar / restaurar) y comparacion entre dos
# partidas: el save abierto (con sus cambios pendientes) contra otro archivo o
# una copia. La comparacion es SEMANTICA (entrenador, mochila, Pokemon, Pokedex,
# mundo), no byte a byte.
# =============================================================================

require 'fileutils'

module Sem
  module Backups
    SUFFIX = /\A(?<ts>\d{8}-\d{6})(?<pre>-prerestore)?\.bak\z/

    module_function

    # Copias que `save_document` deja junto al save: <save>.<AAAAMMDD-HHMMSS>.bak
    # (Dir.children + comparacion de prefijo, NO Dir.glob: los corchetes de algunas rutas lo rompen).
    def list(save_path)
      dir = File.dirname(save_path)
      base = File.basename(save_path)
      Dir.children(dir).filter_map do |name|
        next unless name.start_with?("#{base}.")

        m = SUFFIX.match(name.delete_prefix("#{base}."))
        next unless m

        path = File.join(dir, name)
        st = File.stat(path)
        { file: name, size: st.size, mtime: st.mtime.utc.iso8601, stamp: m[:ts], kind: m[:pre] ? 'prerestore' : 'backup' }
      end.sort_by { |b| b[:stamp] }.reverse
    end

    # Restaura una copia sobre el save: antes guarda el estado actual como "-prerestore.bak" (nunca se pierde nada).
    def restore(save_path, file)
      entry = list(save_path).find { |b| b[:file] == file.to_s }
      raise DriverError.new('BackupNotFound', "no existe la copia #{file.inspect}", { file: file.to_s }) unless entry

      src = File.join(File.dirname(save_path), entry[:file])
      RxDocument.parse(File.binread(src)) # una copia ilegible no debe pisar el save
      safety = "#{save_path}.#{Time.now.strftime('%Y%m%d-%H%M%S')}-prerestore.bak"
      FileUtils.cp(save_path, safety)
      tmp = "#{save_path}.tmp-#{Process.pid}"
      begin
        FileUtils.cp(src, tmp)
        File.rename(tmp, save_path)
      ensure
        File.delete(tmp) if File.exist?(tmp)
      end
      { restored: entry[:file], safetyCopy: File.basename(safety) }
    end
  end

  class Diff
    LIMIT = 200
    POKEMON_FIELDS = %i[species form nickname level exp nature ability item ball gender shiny happiness].freeze

    def initialize(session, other_path)
      raise DriverError.new('FileNotFound', "no se encontro '#{other_path}'", { path: other_path.to_s }) unless other_path && File.file?(other_path)

      @a = Api.state!(session)
      @a_session = session
      other_doc = begin
        RxDocument.parse(File.binread(other_path))
      rescue RxMarshal::FormatError => e
        raise DriverError.new('FormatError', e.message)
      end
      @b_session = Session.new(doc: other_doc, file_path: other_path, output_path: other_path, page_size: 100)
      @b_session.game = session.game
      @b = Api.state!(@b_session)
      @path = other_path
    end

    def run
      trainer = trainer_diff
      bag = bag_diff
      mons = pokemon_diff
      dex = pokedex_diff
      world = world_diff
      {
        against: @path, profile: { current: @a.resolved.summary[:id], other: @b.resolved.summary[:id] },
        trainer: trainer, bag: bag, pokemon: mons, pokedex: dex, world: world,
        summary: { trainer: trainer.size, bag: bag.size, pokemonAdded: mons[:added].size, pokemonRemoved: mons[:removed].size,
                   pokemonChanged: mons[:changed].size, pokemonMoved: mons[:moved].size,
                   pokedex: dex[:seenAdded].size + dex[:seenRemoved].size + dex[:ownedAdded].size + dex[:ownedRemoved].size,
                   world: world.values.sum { |w| w[:changed] } }
      }
    end

    private

    def trainer_diff
      ta = @a.model.trainer_view
      tb = @b.model.trainer_view
      return [] unless ta && tb

      fields = { 'name' => :name, 'money' => :money, 'coins' => :coins, 'battle_points' => :battlePoints, 'soot' => :soot,
                 'id' => :id, 'play_time' => :playTime }
      out = fields.filter_map { |label, key| { field: label, a: ta[key], b: tb[key] } if ta[key] != tb[key] }
      out << { field: 'badges', a: ta[:badges].count(true), b: tb[:badges].count(true) } if ta[:badges].count(true) != tb[:badges].count(true)
      out
    end

    def bag_map(state)
      bag = state.model.bag_view
      return {} unless bag

      bag[:pockets].flat_map { |p| p[:slots] }.each_with_object(Hash.new(0)) { |s, h| h[s[:id].to_s] += s[:qty].to_i }
    end

    def bag_diff
      a = bag_map(@a)
      b = bag_map(@b)
      (a.keys | b.keys).sort.filter_map do |id|
        { id: id, name: @a.model.name_of(:item, id), a: a[id], b: b[id] } if a[id] != b[id]
      end.first(LIMIT)
    end

    # Identidad de un Pokemon: su ID personal; sin el, especie+forma+apodo+nivel (con ordinal si se repite).
    def mon_index(state)
      idx = {}
      seen = Hash.new(0)
      each_mon(state) do |ref, pk|
        f = PokeFacts.read(pk)
        key = f.personal_id && f.personal_id != 0 ? "pid:#{f.personal_id}" : "k:#{f.species}:#{f.form}:#{f.nickname}:#{f.level}"
        if idx.key?(key)
          seen[key] += 1
          key = "#{key}##{seen[key]}"
        end
        idx[key] = { ref: ref, facts: f, summary: state.model.pokemon_summary(pk, ref) }
      end
      idx
    end

    def each_mon(state)
      state.model.party_items.each_with_index { |pk, i| yield "party/#{i}", pk if pk }
      state.model.box_arrays.each_with_index do |(_b, _iv, arr), bi|
        arr&.items&.each_with_index { |pk, si| yield "box/#{bi}/#{si}", pk if pk }
      end
    end

    def mon_dto(entry)
      s = entry[:summary]
      { ref: entry[:ref], species: s.dig(:species, :name), nickname: s[:nickname], level: s[:level] }
    end

    def pokemon_diff
      a = mon_index(@a)
      b = mon_index(@b)
      added = (a.keys - b.keys).map { |k| mon_dto(a[k]) }
      removed = (b.keys - a.keys).map { |k| mon_dto(b[k]) }
      changed = []
      moved = []
      (a.keys & b.keys).each do |k|
        fa = a[k][:facts]
        fb = b[k][:facts]
        diffs = POKEMON_FIELDS.filter_map { |f| { field: f.to_s, a: fa[f], b: fb[f] } if fa[f] != fb[f] }
        diffs << { field: 'moves', a: fa.moves.map { |m| m[:id] }, b: fb.moves.map { |m| m[:id] } } if fa.moves.map { |m| m[:id] } != fb.moves.map { |m| m[:id] }
        diffs << { field: 'iv', a: fa.iv, b: fb.iv } if fa.iv != fb.iv
        diffs << { field: 'ev', a: fa.ev, b: fb.ev } if fa.ev != fb.ev
        changed << mon_dto(a[k]).merge(against: b[k][:ref], diffs: diffs) unless diffs.empty?
        moved << mon_dto(a[k]).merge(from: b[k][:ref]) if a[k][:ref] != b[k][:ref] && diffs.empty?
      end
      { added: added.first(LIMIT), removed: removed.first(LIMIT), changed: changed.first(LIMIT), moved: moved.first(LIMIT),
        totals: { current: a.size, other: b.size } }
    end

    def pokedex_diff
      da = Extras.new(@a_session).pokedex
      db = Extras.new(@b_session).pokedex
      return { available: false, seenAdded: [], seenRemoved: [], ownedAdded: [], ownedRemoved: [] } unless da[:available] && db[:available]

      { available: true, seenAdded: (da[:seen] - db[:seen]).first(LIMIT), seenRemoved: (db[:seen] - da[:seen]).first(LIMIT),
        ownedAdded: (da[:owned] - db[:owned]).first(LIMIT), ownedRemoved: (db[:owned] - da[:owned]).first(LIMIT) }
    end

    # Valores simples por valor; contenedores y objetos por su serializacion Marshal (el id de objeto no vale:
    # son documentos distintos y nunca compartirian identidad).
    def same?(a, b)
      return UI.same_value?(a, b) if Tree.leaf?(a) && Tree.leaf?(b)
      return false if Tree.leaf?(a) || Tree.leaf?(b)

      marshal_bytes(a) == marshal_bytes(b)
    rescue StandardError
      false
    end

    def marshal_bytes(node)
      RxMarshal::Writer.new.write_stream(node).out
    end

    def world_diff
      %w[switches variables].to_h do |kind|
        ea = Extras.new(@a_session)
        eb = Extras.new(@b_session)
        a = ea.world_data(kind)&.first
        b = eb.world_data(kind)&.first
        next [kind.to_sym, { changed: 0, sample: [] }] unless a && b

        names = ea.world_names(kind) || []
        changes = (0...[a.items.size, b.items.size].max).filter_map do |i|
          va = a.items[i]
          vb = b.items[i]
          next if i.zero? || same?(va, vb)

          { id: i, name: names[i], a: Tree.summarize(va)[:display], b: Tree.summarize(vb)[:display] }
        end
        [kind.to_sym, { changed: changes.size, sample: changes.first(60) }]
      end
    end
  end
end
