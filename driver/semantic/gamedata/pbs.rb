# =============================================================================
# pbs.rb — Lector de los archivos PBS/*.txt. Se usa cuando no hay `.dat` legibles
# (Essentials v16-v18, o una carpeta de desarrollo) y para los datos que los `.dat`
# no traen. Soporta, comprobado con Pokémon Z (v16-18) y Pokémon Añil (v21):
#
#   * formato INI de v19+:   [BULBASAUR] / Name = Bulbasaur / BaseStats = 45,49,...
#   * INI de v16-18:         [1] / Name=Bulbasaur / InternalName=BULBASAUR / ...
#   * formato CSV de v16-18: 1,POUND,Pound,000,40,NORMAL,Physical,100,35,...,"Descripcion, con comas"
#
# Detalles que importan (y que rompian el lector anterior): las descripciones del CSV van entre comillas y
# pueden llevar comas; las claves INI no distinguen mayusculas (`pokedex =`); los campos vacios de las
# evoluciones (`ESPEON,HappinessDay,,UMBREON,...`) cuentan como columna; los movimientos de nivel -1 existen.
# Todo es de solo lectura y tolerante: un registro raro se ignora, no aborta la carga.
# =============================================================================

module Sem
  module GameData
    module Pbs
      module_function

      # Orden de los stats en el PBS: HP, Atk, Def, Speed, Sp.Atk, Sp.Def.
      STAT_ORDER = %w[HP ATTACK DEFENSE SPEED SPECIAL_ATTACK SPECIAL_DEFENSE].freeze

      # Probabilidades (%) por casilla de cada tipo de encuentro en v16-18 (el PBS solo lista las especies).
      LEGACY_CHANCES = {
        'land' => [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1], 'cave' => [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1],
        'water' => [60, 30, 5, 4, 1], 'rocksmash' => [60, 30, 5, 4, 1], 'oldrod' => [70, 30],
        'goodrod' => [60, 20, 20], 'superrod' => [40, 40, 15, 4, 1], 'headbuttlow' => [30, 25, 20, 10, 5, 5, 4, 1],
        'headbutthigh' => [30, 25, 20, 10, 5, 5, 4, 1], 'bugcontest' => [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1]
      }.freeze

      # Campos de una seccion INI; las claves no distinguen mayusculas y `f['A', 'B']` devuelve el primero que exista.
      class Fields
        def initialize
          @h = {}
        end

        def []=(key, value)
          @h[key.to_s.strip.downcase] = value
        end

        def [](*keys)
          keys.each do |k|
            v = @h[k.to_s.downcase]
            return v unless v.nil?
          end
          nil
        end

        def key?(key)
          @h.key?(key.to_s.downcase)
        end

        def to_h
          @h.dup
        end
      end

      def read_text(path)
        File.binread(path).force_encoding('UTF-8').scrub.delete_prefix("﻿")
      end

      def lines(text)
        text.each_line.map(&:strip).reject { |l| l.empty? || l.start_with?('#') }
      end

      # [[encabezado, Fields], ...] del formato INI. El encabezado admite un comentario final (`[002] # Ruta 1`).
      def ini_sections(text)
        out = []
        cur = nil
        lines(text).each do |l|
          if l =~ /\A\[(.+?)\]\s*(?:#.*)?\z/
            cur = [Regexp.last_match(1).strip, Fields.new]
            out << cur
          elsif cur && l =~ /\A([^=]+?)\s*=\s*(.*)\z/
            cur[1][Regexp.last_match(1)] = Regexp.last_match(2).strip
          end
        end
        out
      end

      # Parte una fila CSV respetando "comillas" y "" dentro de ellas.
      def csv_split(line)
        out = []
        cur = +''
        quoted = false
        i = 0
        while i < line.length
          c = line[i]
          if quoted
            if c == '"'
              if line[i + 1] == '"'
                cur << '"'
                i += 1
              else
                quoted = false
              end
            else
              cur << c
            end
          elsif c == '"'
            quoted = true
          elsif c == ','
            out << cur.strip
            cur = +''
          else
            cur << c
          end
          i += 1
        end
        out << cur.strip
      end

      def csv_rows(text)
        lines(text).filter_map { |l| l =~ /\A\d+\s*,/ ? csv_split(l) : nil }
      end

      def csv?(text)
        lines(text).first.to_s.match?(/\A\d+\s*,/)
      end

      # Lista separada por comas sin vacios.
      def list(value)
        value.to_s.split(',').map(&:strip).reject(&:empty?)
      end

      # Lista que conserva los vacios (FormNames: el indice es el numero de forma).
      def list_keep(value)
        parts = value.to_s.split(',', -1).map(&:strip)
        parts.pop while parts.last == ''
        parts
      end

      def pairs_moves(value)
        list(value).each_slice(2).filter_map { |lv, mv| lv =~ /\A-?\d+\z/ && mv ? [lv.to_i, mv] : nil }
      end

      # [[SPECIES, Metodo, Parametro], ...]; el parametro puede estar vacio (columna presente).
      def triples_evo(value)
        parts = value.to_s.split(',', -1).map(&:strip)
        parts.pop if parts.size % 3 == 1 && parts.last.empty?
        parts.each_slice(3).filter_map do |sp, method, param|
          next if sp.to_s.empty? || method.to_s.empty?

          { species: sp, method: method, param: param.to_s.empty? ? nil : (param =~ /\A\d+\z/ ? param.to_i : param), prevo: false }
        end
      end

      def num(v)
        v.to_s =~ /\A-?\d+\z/ ? v.to_i : nil
      end

      def float(v)
        Float(v.to_s)
      rescue ArgumentError, TypeError
        nil
      end

      def truthy?(v)
        %w[true yes 1].include?(v.to_s.downcase)
      end

      def stats_from(value)
        list(value).each_with_index.each_with_object({}) { |(v, i), h| h[STAT_ORDER[i]] = v.to_i if STAT_ORDER[i] }
      end

      # Z: `EffortPoints=0,0,0,0,1,0` (orden del PBS). Añil: `EVs = SPECIAL_ATTACK,1,HP,2`.
      def ev_yield(f)
        if f['EffortPoints']
          stats_from(f['EffortPoints']).reject { |_, v| v.zero? }
        elsif f['EVs']
          list(f['EVs']).each_slice(2).each_with_object({}) do |(stat, n), h|
            canonical = Sem::STAT_ALIASES[stat.to_s.upcase]
            h[canonical] = n.to_i if canonical && n =~ /\A\d+\z/
          end
        else
          {}
        end
      end

      def wild_items(f)
        { common: list(f['WildItemCommon']), uncommon: list(f['WildItemUncommon']), rare: list(f['WildItemRare']) }
          .reject { |_, v| v.empty? }
      end

      # ── Especies ──────────────────────────────────────────────────────────
      def species_entry(header, f)
        number = nil
        id = header
        if header =~ /\A\d+\z/
          number = header.to_i
          id = f['InternalName']
        elsif header.include?(',')
          sp, form = header.split(',', 2).map(&:strip)
          id = "#{sp}_#{form}"
        end
        return nil if id.to_s.empty?

        form = id =~ /_(\d+)\z/ ? Regexp.last_match(1).to_i : 0
        base = id.sub(/_\d+\z/, '')
        types = f['Types'] ? list(f['Types']) : [f['Type1'], f['Type2']].compact.reject(&:empty?)
        mega = f['MegaStone'] || f['MegaMove'] ? { stone: f['MegaStone'], move: f['MegaMove'], message: num(f['MegaMessage']), unmega: num(f['UnmegaForm']) } : nil
        Species.new(
          id: id, species: base, form: form, number: number, name: f['Name'], form_name: f['FormName'],
          types: types.map(&:upcase).uniq, base_stats: stats_from(f['BaseStats']),
          growth_rate: f['GrowthRate'] ? Tables.growth_rate_id(f['GrowthRate']) : nil,
          gender_ratio: f['GenderRatio', 'GenderRate'], moves: pairs_moves(f['Moves']),
          tutor_moves: list(f['TutorMoves']), egg_moves: list(f['EggMoves']),
          abilities: list(f['Abilities']), hidden_abilities: list(f['HiddenAbilities', 'HiddenAbility']),
          evolutions: triples_evo(f['Evolutions']), base_exp: num(f['BaseEXP', 'BaseExp']), flags: list(f['Flags']),
          catch_rate: num(f['CatchRate', 'Rareness']), happiness: num(f['Happiness']), ev_yield: ev_yield(f),
          egg_groups: list(f['EggGroups', 'Compatibility']), hatch_steps: num(f['HatchSteps', 'StepsToHatch']),
          height: float(f['Height']), weight: float(f['Weight']), color: f['Color'], shape: f['Shape'],
          habitat: f['Habitat'], category: f['Category', 'Kind'], pokedex: f['Pokedex'], generation: num(f['Generation']),
          wild_items: wild_items(f), form_names: list_keep(f['FormNames']), mega: mega, region: f['Region']
        )
      end

      def species(text)
        ini_sections(text).filter_map { |header, f| species_entry(header, f) }
      end

      # Campos que una forma de pokemon_forms.txt hereda de la especie base cuando no los declara.
      INHERITED = %i[name types base_stats growth_rate gender_ratio moves tutor_moves egg_moves abilities
                     hidden_abilities evolutions base_exp catch_rate happiness ev_yield egg_groups hatch_steps height
                     weight color shape habitat category pokedex generation wild_items].freeze

      def blank?(v)
        v.nil? || (v.respond_to?(:empty?) && v.empty?)
      end

      # Especies + formas; las formas del PBS solo traen las diferencias, el resto se hereda de la base.
      # `order` = posicion en el listado nacional (el PBS de v19+ no numera las especies).
      def species_with_forms(text, forms_text = nil)
        base = species(text)
        by_id = base.to_h { |s| [s.id, s] }
        base.each_with_index do |s, i|
          s.order = s.number || (i + 1)
          s.growth_rate ||= 'Medium'
        end
        forms = forms_text ? species(forms_text) : []
        forms.each do |fm|
          parent = by_id[fm.species]
          next unless parent

          INHERITED.each do |field|
            fm[field] = parent[field] if blank?(fm[field])
          end
          fm.growth_rate ||= parent.growth_rate
          fm.order = parent.order
        end
        base + forms.reject { |fm| by_id.key?(fm.id) }
      end

      # tm.txt de v16-18: `[MOVE]` y, debajo, las especies que la aprenden (varias lineas, coma final).
      def tm(text)
        out = {}
        cur = nil
        lines(text).each do |l|
          if l =~ /\A\[(.+)\]\z/
            cur = Regexp.last_match(1).strip
            out[cur] ||= []
          elsif cur
            out[cur].concat(list(l))
          end
        end
        out.reject { |_, v| v.empty? }
      end

      # ── Movimientos ───────────────────────────────────────────────────────
      def moves(text)
        if csv?(text)
          csv_rows(text).filter_map do |c|
            next if c.size < 9

            Move.new(id: c[1], number: c[0].to_i, name: c[2], function_code: c[3], power: num(c[4]), type: c[5],
                     category: category_index(c[6]), accuracy: num(c[7]), total_pp: num(c[8]), effect_chance: num(c[9]),
                     target: c[10], priority: num(c[11]), flags: c[12].to_s.chars, description: c[13])
          end
        else
          ini_sections(text).map do |id, f|
            Move.new(id: id, name: f['Name'], type: f['Type'], category: category_index(f['Category']),
                     power: num(f['Power']), accuracy: num(f['Accuracy']), total_pp: num(f['TotalPP']),
                     flags: list(f['Flags']), description: f['Description'], target: f['Target'],
                     priority: num(f['Priority']), effect_chance: num(f['EffectChance']), function_code: f['FunctionCode'])
          end
        end
      end

      def category_index(v)
        case v.to_s.downcase
        when 'physical', '0' then 0
        when 'special', '1' then 1
        when 'status', '2' then 2
        end
      end

      # ── Objetos ───────────────────────────────────────────────────────────
      def items(text)
        if csv?(text)
          csv_rows(text).filter_map do |c|
            next if c.size < 5

            move = c[10].to_s
            Item.new(id: c[1], number: c[0].to_i, name: c[2], name_plural: c[3], pocket: num(c[4]), price: num(c[5]),
                     description: c[6], field_use: num(c[7]), battle_use: num(c[8]),
                     move: move.empty? || move == '0' ? nil : move, flags: [])
          end
        else
          ini_sections(text).map do |id, f|
            Item.new(id: id, name: f['Name'], name_plural: f['NamePlural'], pocket: num(f['Pocket']), price: num(f['Price']),
                     field_use: field_use_index(f['FieldUse']), battle_use: field_use_index(f['BattleUse']),
                     move: f['Move'], flags: list(f['Flags']), description: f['Description'], bp_price: num(f['BPPrice']))
          end
        end
      end

      def field_use_index(v)
        { 'ONPOKEMON' => 1, 'DIRECT' => 2, 'TM' => 3, 'HM' => 4, 'TR' => 5 }[v.to_s.strip.upcase] || num(v)
      end

      # ── Habilidades ───────────────────────────────────────────────────────
      def abilities(text)
        if csv?(text)
          csv_rows(text).filter_map do |c|
            c.size >= 3 ? Ability.new(id: c[1], number: c[0].to_i, name: c[2], description: c[3]) : nil
          end
        else
          ini_sections(text).map { |id, f| Ability.new(id: id, name: f['Name'], description: f['Description']) }
        end
      end

      # Z numera los tipos (`[0]`) y pone el id en `InternalName`; Añil usa `[NORMAL]`.
      def types(text)
        ini_sections(text).filter_map do |header, f|
          id = header =~ /\A\d+\z/ ? f['InternalName'] : header
          next if id.to_s.empty?

          # Fila del tipo en `types.png`: `IconPosition` (v19+) o, en v16-18, el numero de la seccion.
          icon = num(f['IconPosition']) || (header =~ /\A\d+\z/ ? header.to_i : nil)
          TypeInfo.new(id: id, name: f['Name'], weaknesses: list(f['Weaknesses']), resistances: list(f['Resistances']),
                       immunities: list(f['Immunities']), special: truthy?(f['IsSpecialType']), icon_position: icon)
        end
      end

      # Clases de entrenador: v16-18 es CSV (`ID,InternalName,Name,...`); v19+ es INI (`[INTERNAL]` + `Name=`), y alguna
      # base numera las secciones (`[4]` + `InternalName=`).
      def trainer_types(text)
        if csv?(text)
          csv_rows(text).filter_map do |c|
            c.size >= 3 && !c[1].to_s.empty? ? TrainerTypeInfo.new(id: c[0].to_i, internal: c[1], name: c[2]) : nil
          end
        else
          ini_sections(text).filter_map do |header, f|
            numbered = header =~ /\A\d+\z/
            internal = numbered ? f['InternalName'] : header
            next if internal.to_s.empty?

            TrainerTypeInfo.new(id: numbered ? header.to_i : nil, internal: internal, name: f['Name'])
          end
        end
      end

      # metadata.txt: los jugadores. v16-18: seccion global `[000]` con `PlayerA..PlayerF = TipoDeEntrenador,charset,...`;
      # v19+: una seccion por jugador (`[1]`...) con `TrainerType = ...`.
      #   -> { legacy: [{ trainer_type:, charset: }, ...] (indice 0 = PlayerA), sections: { 1 => { trainer_type:, charset: } } }
      def player_metadata(text)
        out = { legacy: [], sections: {} }
        ini_sections(text).each do |header, f|
          n = header.to_i
          if f.key?('TrainerType')
            out[:sections][n] = { trainer_type: f['TrainerType'], charset: f['WalkCharset'] } if header =~ /\A\d+\z/ && n.positive?
          elsif n.zero? && header =~ /\A\d+\z/
            %w[PlayerA PlayerB PlayerC PlayerD PlayerE PlayerF PlayerG PlayerH].each do |key|
              v = f[key]
              break if v.nil?

              parts = list(v)
              out[:legacy] << { trainer_type: parts[0], charset: parts[1] }
            end
          end
        end
        out
      end

      def ribbons(text)
        ini_sections(text).map do |id, f|
          Ribbon.new(id: id, name: f['Name'], description: f['Description'], icon: num(f['IconPosition']))
        end
      end

      # regional_dexes.txt (v19+): `[N]` y una especie por linea.
      def regional_dexes(text)
        out = []
        cur = nil
        lines(text).each do |l|
          if l =~ /\A\[(\d+)\]\z/
            cur = { index: Regexp.last_match(1).to_i, species: [] }
            out << cur
          elsif cur
            cur[:species].concat(list(l))
          end
        end
        out
      end

      # ── Encuentros salvajes ───────────────────────────────────────────────
      # [{ map:, name:, tables: [{ type:, slots: [{ species:, min:, max:, chance: }] }] }]
      # v16-18: `007 # Ruta 1` / `12,2,2` (densidades) / `Land` / `ESPECIE,min,max`...
      # v19+:   `[007] # Ruta 1` / `Land,12` / `25,ESPECIE,min,max`...
      def encounters(text)
        v20 = text.match?(/^\s*\[\d+/)
        maps = []
        map = nil
        table = nil
        text.each_line do |raw|
          l = raw.strip
          next if l.empty? || l.start_with?('#')

          if (m = l.match(/\A\[(\d+)(?:,\d+)?\]\s*(?:#\s*(.*))?\z/) || l.match(/\A(\d+)\s*(?:#\s*(.*))?\z/))
            map = { map: m[1].to_i, name: m[2]&.strip.to_s.empty? ? nil : m[2].strip, tables: [] }
            maps << map
            table = nil
          elsif map.nil?
            next
          elsif v20 ? l =~ /\A[A-Za-z]\w*(?:\s*,\s*\d+)?\z/ : l =~ /\A[A-Za-z]\w*\z/
            table = { type: l.split(',').first.strip, slots: [] }
            map[:tables] << table
          elsif table
            cols = l.split(',').map(&:strip)
            sp, min, max = v20 ? [cols[1], cols[2], cols[3]] : [cols[0], cols[1], cols[2]]
            next if sp.to_s.empty? || sp =~ /\A\d+\z/

            slot = { species: sp, min: num(min), max: num(max || min), chance: v20 ? num(cols[0]) : nil }
            table[:slots] << slot
          end
        end
        fill_legacy_chances!(maps) unless v20
        maps
      end

      def fill_legacy_chances!(maps)
        maps.each do |m|
          m[:tables].each do |t|
            chances = LEGACY_CHANCES[t[:type].downcase.sub(/(morning|day|night)\z/, '')]
            t[:slots].each_with_index { |s, i| s[:chance] = chances&.at(i) }
          end
        end
      end
    end
  end
end
