# =============================================================================
# store.rb — Datos del juego vinculado: especies, movimientos, objetos,
# habilidades y tipos (de `Data/*.dat`, con respaldo en `PBS/*.txt`), limites
# de `Settings` y nombres de switches/variables.
#
# Solo LEE: nunca escribe nada en la carpeta del juego ni ejecuta su codigo.
# =============================================================================

require 'set'

module Sem
  module GameData
    class Store
      DOMAINS = %i[species moves items abilities types].freeze
      PBS_FILES = {
        species: %w[pokemon.txt], moves: %w[moves.txt], items: %w[items.txt],
        abilities: %w[abilities.txt], types: %w[types.txt]
      }.freeze
      CONVERTERS = { species: :species, moves: :move, items: :item, abilities: :ability, types: :type }.freeze

      LearnProfile = Struct.new(:min_level, :always, keyword_init: true)

      attr_reader :root, :info, :domains, :limit_overrides, :limit_sources, :settings_files, :errors, :source, :version

      def initialize(root, source: 'manual')
        @root = root
        @source = source
        @info = Locator.describe(root)
        @tables = {}
        @by_number = {}
        @domains = DOMAINS.to_h { |d| [d, { count: 0, source: 'none', error: nil }] }
        @errors = []
        @limit_overrides = {}
        @limit_sources = {}
        @settings_files = 0
        @version = nil
        @flavor = nil
        @system = :unloaded
        @profiles = {}
        @prevos = nil
        @loaded = false
      end

      def self.load(root, source: 'manual')
        new(root, source: source).tap(&:load!)
      end

      def load!
        return self if @loaded

        raise DriverError.new('GameFolderInvalid', 'la carpeta no existe', { path: @root }) unless File.directory?(@root)

        DOMAINS.each { |d| load_domain(d) }
        scan_settings
        @version = guess_version
        @loaded = true
        self
      end

      # Limites efectivos del juego (los de Settings si se encontraron, vanilla si no).
      def limits
        SettingsScan::DEFAULTS.merge(@limit_overrides)
      end

      # ── Estado ────────────────────────────────────────────────────────────
      def state
        loaded = DOMAINS.count { |d| @domains[d][:count].positive? }
        return 'error' if loaded.zero?
        return 'ready' if %i[species moves items abilities].all? { |d| @domains[d][:count].positive? }

        'partial'
      end

      def count(domain)
        @domains[domain][:count]
      end

      def species?
        count(:species).positive?
      end

      # ── Consultas ─────────────────────────────────────────────────────────
      def table(domain)
        @tables[domain] || {}
      end

      def species_entry(id, form = 0)
        return nil if id.nil?

        key = id.to_s
        return by_number(:species, id) if id.is_a?(Integer)

        entry = form.to_i.positive? ? table(:species)["#{key}_#{form.to_i}"] : nil
        entry || table(:species)[key]
      end

      def base_species(id)
        table(:species)[id.to_s]
      end

      def move(id)
        id.is_a?(Integer) ? by_number(:moves, id) : table(:moves)[id.to_s]
      end

      def item(id)
        id.is_a?(Integer) ? by_number(:items, id) : table(:items)[id.to_s]
      end

      def ability(id)
        id.is_a?(Integer) ? by_number(:abilities, id) : table(:abilities)[id.to_s]
      end

      def by_number(domain, number)
        (@by_number[domain] ||= table(domain).values.each_with_object({}) { |e, h| h[e.number] ||= e if e.respond_to?(:number) && e.number })[number]
      end

      # Nombre del juego para un id, o nil si no se conoce (el llamador cae al embebido/ID).
      def name_of(kind, id)
        entry = case kind
                when :species then species_entry(id)
                when :move then move(id)
                when :item then item(id)
                when :ability then ability(id)
                when :type then table(:types)[id.to_s]
                end
        entry&.name unless entry&.name.to_s.empty?
      end

      def types
        list = table(:types).values
        list = STANDARD_TYPES.map { |t| TypeInfo.new(id: t, name: nil) } if list.empty?
        list
      end

      def system_data
        @system = SystemData.read(@root) if @system == :unloaded
        @system
      end

      # ── Datos derivados de las especies ──────────────────────────────────
      def base_stats(id, form = 0)
        e = species_entry(id, form)
        return e.base_stats unless e.nil? || e.base_stats.empty?

        base_species(id)&.base_stats || {}
      end

      def abilities_for(id, form = 0)
        [species_entry(id, form), base_species(id)].compact.flat_map { |e| e.abilities + e.hidden_abilities }.uniq
      end

      def growth_rate(id, form = 0)
        species_entry(id, form)&.growth_rate || 'Medium'
      end

      def gender_ratio(id, form = 0)
        e = species_entry(id, form)
        e&.gender_ratio || base_species(id)&.gender_ratio
      end

      # Especies (base) de las que evoluciona `id`, de la mas cercana a la mas lejana.
      def prevos(id)
        @prevos ||= build_prevo_index
        out = []
        cur = id.to_s
        seen = Set.new
        while (p = @prevos[cur]) && seen.add?(p)
          out << p
          cur = p
        end
        out
      end

      # { min_level: { 'MOVE' => nivel }, always: Set } de lo que puede aprender la especie
      # (con sus preevoluciones): por nivel, tutores/MT y movimientos huevo.
      def learn_profile(id, form = 0)
        @profiles[[id.to_s, form.to_i]] ||= build_profile(id, form.to_i)
      end

      def move_learnable?(id, form, level, move_id)
        pr = learn_profile(id, form)
        m = move_id.to_s
        return true if pr.always.include?(m)

        lv = pr.min_level[m]
        !lv.nil? && lv <= level.to_i
      end

      # Nivel minimo "razonable" segun las evoluciones por nivel de sus preevoluciones.
      def minimum_level(id)
        lvl = 1
        child = id.to_s
        prevos(id).each do |pv|
          evo = base_species(pv)&.evolutions&.find { |e| e[:species] == child && !e[:prevo] }
          lvl = [lvl, evo[:param]].max if evo && evo[:method] =~ /Level/i && evo[:param].is_a?(Integer)
          child = pv
        end
        lvl
      end

      private

      def load_domain(domain)
        status = @domains[domain]
        dat = Locator.resolve(@root, "Data/#{domain}.dat")
        if dat
          begin
            entries = read_dat(domain, dat)
            if entries.any?
              store(domain, entries, 'dat')
              return
            end
            status[:error] = 'empty'
          rescue RxMarshal::FormatError, StandardError => e
            status[:error] = "#{e.class}: #{e.message}"[0, 200]
          end
        end
        load_pbs(domain)
      end

      def read_dat(domain, path)
        data = DatReader.read(path)
        return [] unless data.is_a?(Hash)

        conv = CONVERTERS.fetch(domain)
        seen = Set.new
        data.filter_map do |key, obj|
          next unless obj.is_a?(Obj)

          @flavor ||= flavor_of(obj) if domain == :species

          e = Entries.public_send(conv, obj, key)
          e if e && seen.add?(e.id)
        end
      end

      def load_pbs(domain)
        PBS_FILES[domain].each do |name|
          path = Locator.resolve(@root, "PBS/#{name}")
          next unless path

          extra = domain == :species ? Locator.resolve(@root, 'PBS/pokemon_forms.txt') : nil
          text = Pbs.read_text(path)
          entries = Pbs.public_send(domain, text)
          entries += Pbs.species(Pbs.read_text(extra)) if extra
          entries = entries.compact
          if entries.any?
            store(domain, entries, 'pbs')
            return nil
          end
        rescue StandardError => e
          @domains[domain][:error] = "#{e.class}: #{e.message}"[0, 200]
        end
        nil
      end

      def store(domain, entries, source)
        @tables[domain] = entries.each_with_object({}) { |e, h| h[e.id] ||= e }
        @domains[domain] = { count: @tables[domain].size, source: source, error: @domains[domain][:error] }
      end

      def scan_settings
        res = SettingsScan.scan(@root)
        @limit_overrides = res[:values]
        @limit_sources = res[:found]
        @settings_files = res[:files]
        @errors << res[:error] if res[:error]
      end

      # Version aproximada de Essentials segun los ivars de GameData::Species.
      def flavor_of(obj)
        return 'v21' if obj.key?('types')
        return 'v19' if obj.key?('id_number')
        return 'v20' if obj.key?('type1')

        nil
      end

      def guess_version
        return nil unless species?

        @domains[:species][:source] == 'pbs' ? 'pbs' : @flavor
      end

      def build_prevo_index
        idx = {}
        table(:species).each_value do |sp|
          next unless sp.form.zero?

          sp.evolutions.each { |e| idx[e[:species]] ||= sp.id unless e[:prevo] }
        end
        idx
      end

      def build_profile(id, form)
        entries = [species_entry(id, form), base_species(id)].compact.uniq
        chain = ([id.to_s] + prevos(id)).filter_map { |s| base_species(s) }
        min = {}
        always = Set.new
        (entries + chain).uniq.each do |e|
          e.moves.each { |lv, mv| min[mv] = lv if min[mv].nil? || lv < min[mv] }
          always.merge(e.tutor_moves)
          always.merge(e.egg_moves)
        end
        LearnProfile.new(min_level: min, always: always)
      end
    end
  end
end
