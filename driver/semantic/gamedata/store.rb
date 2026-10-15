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

      attr_reader :root, :info, :domains, :limit_overrides, :limit_sources, :settings_files, :errors, :source, :version,
                  :ball_types

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

      # Pasos de la carga (el orden importa: las MT se aplican a las especies ya cargadas y la version se
      # deduce de ellas). La UI puede ejecutarlos uno a uno (`load_step!`) para mostrar el progreso real.
      STEP_IDS = %w[species moves items abilities types extras settings].freeze

      def steps
        STEP_IDS
      end

      def load!
        return self if @loaded

        check_root!
        STEP_IDS.each { |id| load_step!(id) }
        self
      end

      def check_root!
        raise DriverError.new('GameFolderInvalid', 'la carpeta no existe', { path: @root }) unless File.directory?(@root)
      end

      def load_step!(id)
        return self if @loaded

        key = id.to_s
        case key
        when *DOMAINS.map(&:to_s) then load_domain(key.to_sym)
        when 'extras' then apply_tm_moves
        when 'settings'
          scan_settings
          @version = guess_version
          @loaded = true
        else raise DriverError.new('ValidationError', "paso de carga desconocido: #{id}", { code: 'unknown_step', step: id })
        end
        self
      end

      def loaded?
        @loaded
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

      def base_or_form_number(id)
        e = table(:species)[id.to_s]
        e&.number
      end

      def species_entry(id, form = 0)
        return nil if id.nil?

        key = id.to_s
        return by_number(:species, id) if id.is_a?(Integer)

        entry = form.to_i.positive? ? table(:species)["#{key}_#{form.to_i}"] : nil
        entry || table(:species)[key]
      end

      # Bases <= v18 con PBS de texto (CSV numerado): las formas (Mega, regionales...) no estan en el PBS sino en scripts,
      # asi que el PBS no puede decir si una forma existe.
      def forms_scripted?
        return @forms_scripted unless @forms_scripted.nil?

        @forms_scripted = @domains[:species][:source] == 'pbs' && table(:species).each_value.any? { |s| s.form.zero? && !s.number.nil? }
      end

      # Especie base (forma 0). Acepta el id interno ('ARCANINE') o el numero de las bases <= v18 (59).
      def base_species(id)
        return nil if id.nil?

        e = id.is_a?(Integer) ? by_number(:species, id) : table(:species)[id.to_s]
        e && (e.form.zero? ? e : table(:species)[e.species])
      end

      # Todas las entradas (forma 0 y formas) de una especie base, por su id interno.
      def species_forms(species)
        @forms_by_species ||= table(:species).each_value.group_by(&:species)
        @forms_by_species[species.to_s] || []
      end

      # ¿Es valida la forma `form` de la especie? Que no exista la entrada `ESPECIE_N` no basta para decir que no:
      # en v20/v21 hay formas por defecto (`Flags = DefaultForm_N`, p. ej. MR. RIME 1), huecos entre las formas definidas
      # (formas cosmeticas, p. ej. MINIOR) y especies cuyas formas no estan en el PBS (se fijan por scripts).
      def form_exists?(id, form)
        form = form.to_i
        return true if form <= 0

        base = base_species(id)
        return true if base.nil?
        return true if table(:species)["#{base.species}_#{form}"]
        return true if base.flags.map { |f| f.to_s.downcase }.include?("defaultform_#{form}")

        defined = species_forms(base.species).select { |e| e.form.positive? }.map(&:form)
        defined.empty? || form < defined.max
      end

      # Id interno de una especie (acepta numeros de bases <= v18).
      def species_key(id)
        id.is_a?(Integer) ? (by_number(:species, id)&.species || id.to_s) : id.to_s
      end

      def move(id)
        id.is_a?(Integer) ? by_number(:moves, id) : table(:moves)[id.to_s]
      end

      # Id interno de un movimiento (acepta numeros de bases <= v18).
      def move_key(id)
        id.is_a?(Integer) ? (by_number(:moves, id)&.id || id.to_s) : id.to_s
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

      # Numero (id entero de las bases <= v18) de una entidad dada su id interno ('BULBASAUR' -> 1), o nil.
      #   kind: :species | :move | :item | :ability | :ball (indice de $BallTypes) | :nature (indice 0-24)
      def number_for(kind, id)
        case kind
        when :species then base_or_form_number(id)
        when :move then table(:moves)[id.to_s]&.number
        when :item then table(:items)[id.to_s]&.number
        when :ability then table(:abilities)[id.to_s]&.number
        when :ball then Derived.ball_index_of(self, id)
        when :nature then Tables::NATURE_IDS.index(id.to_s.upcase)
        end
      end

      # Nombre del juego para un id, o nil si no se conoce (el llamador cae al embebido/ID).
      def name_of(kind, id)
        entry = case kind
                when :species then species_entry(id)
                when :move then move(id)
                when :item then item(id)
                when :ability then ability(id)
                when :type then table(:types)[id.to_s]
                when :ribbon then ribbons.find { |r| r.id.to_s == id.to_s }
                end
        entry&.name unless entry&.name.to_s.empty?
      end

      def types
        list = table(:types).values
        list = STANDARD_TYPES.each_with_index.map { |t, i| TypeInfo.new(id: t, name: nil, icon_position: i) } if list.empty?
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
        cur = species_key(id)
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
        key = species_key(id)
        @profiles[[key, form.to_i]] ||= build_profile(key, form.to_i)
      end

      def move_learnable?(id, form, level, move_id)
        pr = learn_profile(id, form)
        m = move_key(move_id)
        return true if pr.always.include?(m)

        lv = pr.min_level[m]
        !lv.nil? && lv <= level.to_i
      end

      # Nivel minimo "razonable" segun las evoluciones por nivel de sus preevoluciones.
      def minimum_level(id)
        lvl = 1
        child = species_key(id)
        prevos(id).each do |pv|
          evo = base_species(pv)&.evolutions&.find { |e| e[:species] == child && !e[:prevo] }
          lvl = [lvl, evo[:param]].max if evo && evo[:method] =~ /Level/i && evo[:param].is_a?(Integer)
          child = pv
        end
        lvl
      end

      # ── Datos de apoyo del PBS (opcionales y perezosos) ───────────────────
      # Cintas (ribbons.txt, v19+): [Ribbon].
      def ribbons
        @ribbons ||= pbs_optional('ribbons.txt') { |t| Pbs.ribbons(t) } || []
      end

      # Pokédex regionales (regional_dexes.txt, v19+): [{ index:, species: [...] }].
      def regional_dexes
        @regional_dexes ||= pbs_optional('regional_dexes.txt') { |t| Pbs.regional_dexes(t) } || []
      end

      # Encuentros salvajes (encounters.txt, ambos formatos).
      def encounter_maps
        @encounter_maps ||= pbs_optional('encounters.txt') { |t| Pbs.encounters(t) } || []
      end

      # Donde aparece una especie: [{ map:, name:, method:, min:, max:, chance: }], agregado por mapa y metodo.
      def encounters_for(id)
        key = id.to_s
        out = {}
        encounter_maps.each do |m|
          m[:tables].each do |t|
            hits = t[:slots].select { |s| s[:species].to_s == key }
            next if hits.empty?

            row = (out[[m[:map], t[:type]]] ||= { map: m[:map], name: m[:name] || map_name(m[:map]), method: t[:type],
                                                  min: nil, max: nil, chance: nil })
            hits.each do |h|
              row[:min] = [row[:min], h[:min]].compact.min
              row[:max] = [row[:max], h[:max]].compact.max
              row[:chance] = (row[:chance] || 0) + h[:chance] if h[:chance]
            end
          end
        end
        out.values.sort_by { |r| [r[:map], r[:method]] }
      end

      # Nombre de un mapa (de MapInfos.rxdata, si existe y se pudo leer).
      def map_name(number)
        @map_names ||= MapInfos.read(@root)
        @map_names[number.to_i]
      end

      # Numero de la especie en cada Pokédex regional: { indice => posicion (1-based) }.
      def regional_numbers(id)
        regional_dexes.each_with_object({}) do |d, h|
          pos = d[:species].index(id.to_s)
          h[d[:index]] = pos + 1 if pos
        end
      end

      private

      def pbs_optional(name)
        path = Locator.resolve(@root, "PBS/#{name}")
        path ? yield(Pbs.read_text(path)) : nil
      rescue StandardError => e
        @errors << "#{name}: #{e.class}: #{e.message}"[0, 200]
        nil
      end

      # MT de v16-18 (tm.txt): cada especie guarda los movimientos de MT que aprende.
      def apply_tm_moves
        return unless species?

        table = pbs_optional('tm.txt') { |t| Pbs.tm(t) }
        return if table.nil? || table.empty?

        by_species = Hash.new { |h, k| h[k] = [] }
        table.each { |move, list| list.each { |sp| by_species[sp] << move } }
        table(:species).each_value do |e|
          mv = by_species[e.species]
          e.tm_moves = (e.tm_moves + mv).uniq unless mv.empty?
        end
      end

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

          text = Pbs.read_text(path)
          entries =
            if domain == :species
              extra = Locator.resolve(@root, 'PBS/pokemon_forms.txt')
              Pbs.species_with_forms(text, extra && Pbs.read_text(extra))
            else
              Pbs.public_send(domain, text)
            end
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
        @ball_types = res[:balls].empty? ? nil : res[:balls]
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
        # Tambien las formas: una evolucion puede existir solo desde una forma (SNEASEL de Hisui -> SNEASLER).
        table(:species).each_value do |sp|
          sp.evolutions.each { |e| idx[e[:species]] ||= sp.species unless e[:prevo] }
        end
        idx
      end

      def build_profile(id, form)
        entries = [species_entry(id, form), base_species(id)].compact.uniq
        # De las preevoluciones cuentan TODAS sus formas: el indice de forma puede cambiar al evolucionar
        # (ARCANINE de Hisui hereda los movimientos huevo de GROWLITHE de Hisui) y un falso "no puede aprenderlo"
        # es peor que un falso "si puede".
        chain = prevos(id).flat_map { |s| species_forms(s) }
        min = {}
        always = Set.new
        (entries + chain).uniq.each do |e|
          e.moves.each { |lv, mv| min[mv] = lv if min[mv].nil? || lv < min[mv] }
          always.merge(e.tutor_moves)
          always.merge(e.egg_moves)
          always.merge(e.tm_moves)
        end
        LearnProfile.new(min_level: min, always: always)
      end
    end
  end
end
