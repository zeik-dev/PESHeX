# =============================================================================
# entries.rb — Estructuras normalizadas de los datos del juego y conversores
# desde los objetos de los `.dat` (v19-v21). Distintas versiones guardan lo mismo
# con ivars distintos (@type1/@type2 vs @types, @base_damage vs @power...): aqui se
# unifican para que el resto del driver no dependa de la version.
# =============================================================================

module Sem
  module GameData
    SPECIES_LIST_FIELDS = %i[types moves tutor_moves egg_moves abilities hidden_abilities evolutions flags tm_moves
                             egg_groups form_names].freeze

    # Ficha de especie/forma. `height`/`weight` en m/kg (Float). `moves` = [[nivel, MOVE]] (nivel 0 = al evolucionar,
    # -1 = solo por recordador en algunas bases); `tm_moves` = movimientos de MT (tm.txt de v16-18).
    Species = Struct.new(
      :id, :species, :form, :number, :order, :name, :form_name, :types, :base_stats, :growth_rate, :gender_ratio,
      :moves, :tutor_moves, :egg_moves, :abilities, :hidden_abilities, :evolutions, :base_exp, :flags,
      :tm_moves, :catch_rate, :happiness, :ev_yield, :egg_groups, :hatch_steps, :height, :weight, :color, :shape,
      :habitat, :category, :pokedex, :generation, :wild_items, :form_names, :mega, :region,
      keyword_init: true
    ) do
      def initialize(**kw)
        super
        SPECIES_LIST_FIELDS.each { |f| self[f] ||= [] }
        self.base_stats ||= {}
        self.ev_yield ||= {}
        self.wild_items ||= {}
      end
    end
    Move = Struct.new(:id, :number, :name, :type, :category, :power, :accuracy, :total_pp, :flags,
                      :description, :target, :priority, :effect_chance, :function_code, keyword_init: true)
    Item = Struct.new(:id, :number, :name, :name_plural, :pocket, :price, :field_use, :move, :flags,
                      :description, :battle_use, :bp_price, keyword_init: true) do
      # MT / MO / DT segun el motor: tiene un movimiento asociado (columna Move / ultima del CSV) o field_use
      # 3/4. (El 5 NO se cuenta: en v16-18 es "se usa sobre un Pokémon, sin mensaje"; las MT de v20+, con su
      # `Move`, ya entran por el movimiento.)
      def machine?
        [3, 4].include?(field_use) || (!move.nil? && !move.to_s.empty? && move.to_s != '0')
      end
    end
    Ability = Struct.new(:id, :number, :name, :description, keyword_init: true)
    TypeInfo = Struct.new(:id, :name, :weaknesses, :resistances, :immunities, :special, :icon_position, keyword_init: true) do
      def initialize(**kw)
        super
        self.weaknesses ||= []
        self.resistances ||= []
        self.immunities ||= []
      end
    end
    Ribbon = Struct.new(:id, :name, :description, :icon, keyword_init: true)
    # Clase de entrenador: `id` es el numero de las bases <= v18 (nil en v19+), `internal` el nombre interno
    # ("POKEMONTRAINER_RojoNeutro") y `name` el nombre visible ("Entrenador").
    TrainerTypeInfo = Struct.new(:id, :internal, :name, keyword_init: true)

    STANDARD_TYPES = %w[NORMAL FIGHTING FLYING POISON GROUND ROCK BUG GHOST STEEL QMARKS FIRE WATER GRASS
                        ELECTRIC PSYCHIC ICE DRAGON DARK FAIRY].freeze

    module Entries
      module_function

      def s(v)
        v.nil? ? nil : v.to_s
      end

      def i(v)
        v.is_a?(Integer) ? v : nil
      end

      def stat_hash(raw)
        return {} unless raw.is_a?(Hash)

        raw.each_with_object({}) do |(k, v), h|
          stat = Sem::STAT_ALIASES[k.to_s.upcase]
          h[stat] = v.to_i if stat && v.is_a?(Integer)
        end
      end

      # [[nivel, :MOVE], ...] -> [[nivel, 'MOVE'], ...]
      def level_moves(raw)
        Array(raw).filter_map do |e|
          e.is_a?(Array) && e.size >= 2 && e[0].is_a?(Integer) ? [e[0], e[1].to_s] : nil
        end
      end

      def symbols(raw)
        Array(raw).filter_map { |x| x.nil? ? nil : x.to_s }
      end

      # [[:IVYSAUR, :Level, 16, false], ...]
      def evolutions(raw)
        Array(raw).filter_map do |e|
          next unless e.is_a?(Array) && e[0]

          { species: e[0].to_s, method: e[1].to_s, param: e[2].is_a?(Symbol) ? e[2].to_s : e[2], prevo: e[3] == true }
        end
      end

      # Altura (dm) y peso (hg) del .dat -> m / kg.
      def tenths(v)
        v.is_a?(Integer) || v.is_a?(Float) ? (v / 10.0).round(1) : nil
      end

      def first_of(iv, *keys)
        keys.each { |k| return iv[k] unless iv[k].nil? }
        nil
      end

      def wild_items(iv)
        out = {}
        { 'common' => 'wild_item_common', 'uncommon' => 'wild_item_uncommon', 'rare' => 'wild_item_rare' }.each do |k, key|
          v = iv[key]
          out[k.to_sym] = Array(v).map(&:to_s) unless v.nil? || (v.respond_to?(:empty?) && v.empty?)
        end
        out
      end

      def mega(iv)
        stone = s(iv['mega_stone'])
        move = s(iv['mega_move'])
        return nil unless stone || move

        { stone: stone, move: move, message: i(iv['mega_message']), unmega: iv['unmega_form'].is_a?(Integer) ? iv['unmega_form'] : nil }
      end

      def species(obj, key = nil)
        iv = obj.iv
        id = s(iv['id'] || key)
        return nil unless id

        form = iv['form'].is_a?(Integer) ? iv['form'] : (id =~ /_(\d+)\z/ ? Regexp.last_match(1).to_i : 0)
        base = s(iv['species']) || id.sub(/_\d+\z/, '')
        types = if iv['types'].is_a?(Array) then symbols(iv['types'])
                else [iv['type1'], iv['type2']].compact.map(&:to_s).uniq
                end
        gender = iv['gender_ratio'] || iv['gender_rate']
        Species.new(
          id: id, species: base, form: form, number: i(iv['id_number']) || i(iv['number']),
          name: s(iv['real_name']) || s(iv['name']), form_name: s(iv['real_form_name'] || iv['form_name']),
          types: types, base_stats: stat_hash(iv['base_stats']),
          growth_rate: Tables.growth_rate_id(iv['growth_rate']), gender_ratio: s(gender),
          moves: level_moves(iv['moves']), tutor_moves: symbols(iv['tutor_moves']), egg_moves: symbols(iv['egg_moves']),
          abilities: symbols(iv['abilities']), hidden_abilities: symbols(iv['hidden_abilities']),
          evolutions: evolutions(iv['evolutions']), base_exp: i(iv['base_exp']), flags: symbols(iv['flags']),
          catch_rate: i(iv['catch_rate']), happiness: i(iv['happiness']), ev_yield: stat_hash(iv['evs']),
          egg_groups: symbols(iv['egg_groups']), hatch_steps: i(iv['hatch_steps']),
          height: tenths(iv['height']), weight: tenths(iv['weight']), color: s(iv['color']), shape: s(iv['shape']),
          habitat: s(iv['habitat']),
          category: s(first_of(iv, 'real_category', 'category', 'real_kind', 'kind')),
          pokedex: s(first_of(iv, 'real_pokedex_entry', 'pokedex_entry', 'real_entry')),
          generation: i(iv['generation']), wild_items: wild_items(iv), mega: mega(iv)
        )
      end

      def move(obj, key = nil)
        iv = obj.iv
        id = s(iv['id'] || key)
        return nil unless id

        Move.new(id: id, number: i(iv['id_number']), name: s(iv['real_name']) || s(iv['name']), type: s(iv['type']),
                 category: i(iv['category']), power: i(iv['power']) || i(iv['base_damage']), accuracy: i(iv['accuracy']),
                 total_pp: i(iv['total_pp']) || i(iv['pp']), flags: Array(iv['flags']).map(&:to_s),
                 description: s(iv['real_description'] || iv['description']), target: s(iv['target']),
                 priority: i(iv['priority']), effect_chance: i(iv['effect_chance']),
                 function_code: s(iv['function_code'] || iv['function'] || iv['function_class']))
      end

      def item(obj, key = nil)
        iv = obj.iv
        id = s(iv['id'] || key)
        return nil unless id

        Item.new(id: id, number: i(iv['id_number']), name: s(iv['real_name']) || s(iv['name']),
                 name_plural: s(iv['real_name_plural']), pocket: i(iv['pocket']), price: i(iv['price']),
                 field_use: i(iv['field_use']), move: s(iv['move']), flags: Array(iv['flags']).map(&:to_s),
                 description: s(iv['real_description'] || iv['description']), battle_use: i(iv['battle_use']),
                 bp_price: i(iv['bp_price']))
      end

      def ability(obj, key = nil)
        iv = obj.iv
        id = s(iv['id'] || key)
        return nil unless id

        Ability.new(id: id, number: i(iv['id_number']), name: s(iv['real_name']) || s(iv['name']),
                    description: s(iv['real_description'] || iv['description']))
      end

      def type(obj, key = nil)
        iv = obj.iv
        id = s(iv['id'] || key)
        id && TypeInfo.new(id: id, name: s(iv['real_name']) || s(iv['name']), weaknesses: symbols(iv['weaknesses']),
                           resistances: symbols(iv['resistances']), immunities: symbols(iv['immunities']),
                           special: iv['special_type'] == true || iv['pseudo_type'] == true,
                           icon_position: iv['icon_position'].is_a?(Integer) ? iv['icon_position'] : nil)
      end
    end
  end
end
