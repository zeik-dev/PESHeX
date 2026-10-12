# =============================================================================
# entries.rb — Estructuras normalizadas de los datos del juego y conversores
# desde los objetos de los `.dat` (v19-v21). Distintas versiones guardan lo mismo
# con ivars distintos (@type1/@type2 vs @types, @base_damage vs @power...): aqui se
# unifican para que el resto del driver no dependa de la version.
# =============================================================================

module Sem
  module GameData
    Species = Struct.new(
      :id, :species, :form, :number, :name, :form_name, :types, :base_stats, :growth_rate, :gender_ratio,
      :moves, :tutor_moves, :egg_moves, :abilities, :hidden_abilities, :evolutions, :base_exp, :flags,
      keyword_init: true
    )
    Move = Struct.new(:id, :number, :name, :type, :category, :power, :accuracy, :total_pp, :flags, keyword_init: true)
    Item = Struct.new(:id, :number, :name, :name_plural, :pocket, :price, :field_use, :move, :flags, keyword_init: true) do
      # MT / MO / DT segun el motor: field_use 3/4/5 o un movimiento asociado.
      def machine?
        [3, 4, 5].include?(field_use) || (!move.nil? && !move.to_s.empty?)
      end
    end
    Ability = Struct.new(:id, :number, :name, :description, keyword_init: true)
    TypeInfo = Struct.new(:id, :name, keyword_init: true)

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
          evolutions: evolutions(iv['evolutions']), base_exp: i(iv['base_exp']), flags: symbols(iv['flags'])
        )
      end

      def move(obj, key = nil)
        iv = obj.iv
        id = s(iv['id'] || key)
        return nil unless id

        Move.new(id: id, number: i(iv['id_number']), name: s(iv['real_name']) || s(iv['name']), type: s(iv['type']),
                 category: i(iv['category']), power: i(iv['power']) || i(iv['base_damage']), accuracy: i(iv['accuracy']),
                 total_pp: i(iv['total_pp']) || i(iv['pp']), flags: Array(iv['flags']).map(&:to_s))
      end

      def item(obj, key = nil)
        iv = obj.iv
        id = s(iv['id'] || key)
        return nil unless id

        Item.new(id: id, number: i(iv['id_number']), name: s(iv['real_name']) || s(iv['name']),
                 name_plural: s(iv['real_name_plural']), pocket: i(iv['pocket']), price: i(iv['price']),
                 field_use: i(iv['field_use']), move: s(iv['move']), flags: Array(iv['flags']).map(&:to_s))
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
        id && TypeInfo.new(id: id, name: s(iv['real_name']) || s(iv['name']))
      end
    end
  end
end
