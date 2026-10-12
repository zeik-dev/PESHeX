# =============================================================================
# codecs.rb — Conversion entre las distintas representaciones que usan las
# bases de Essentials para el mismo dato.
#
#   StatMap : IV/EV/stats como Hash {:HP=>31,...} (v19+) o Array de 6 (v16-v18)
#   Ids     : especie/objeto/movimiento como Symbol (v19+) o Integer (<=v18)
# =============================================================================

module Sem
  STAT_IDS = %w[HP ATTACK DEFENSE SPECIAL_ATTACK SPECIAL_DEFENSE SPEED].freeze
  # Orden de PBStats en Essentials <= v18 (HP, Atk, Def, VELOCIDAD, SpAtk, SpDef).
  LEGACY_STAT_ORDER = %w[HP ATTACK DEFENSE SPEED SPECIAL_ATTACK SPECIAL_DEFENSE].freeze

  STAT_ALIASES = {
    'HP' => 'HP', 'ATTACK' => 'ATTACK', 'ATK' => 'ATTACK', 'DEFENSE' => 'DEFENSE', 'DEF' => 'DEFENSE',
    'SPECIAL_ATTACK' => 'SPECIAL_ATTACK', 'SPATK' => 'SPECIAL_ATTACK', 'SPA' => 'SPECIAL_ATTACK',
    'SPECIAL_DEFENSE' => 'SPECIAL_DEFENSE', 'SPDEF' => 'SPECIAL_DEFENSE', 'SPD' => 'SPECIAL_DEFENSE',
    'SPEED' => 'SPEED', 'SPE' => 'SPEED'
  }.freeze

  module StatMap
    module_function

    # Distingue la disposicion de un nodo de stats: :hash o :array (o nil).
    def layout(node)
      return :hash if Tree.hash?(node)
      return :array if Tree.array?(node)

      nil
    end

    # Lee el nodo a { 'HP'=>31, ... } (valores Integer o nil si no estan).
    def read(node)
      out = STAT_IDS.to_h { |s| [s, nil] }
      case layout(node)
      when :hash
        node.pairs.each do |k, v|
          stat = stat_for_key(k)
          out[stat] = Tree.int_value(v) if stat
        end
      when :array
        node.items.each_with_index do |v, i|
          stat = LEGACY_STAT_ORDER[i]
          out[stat] = Tree.int_value(v) if stat
        end
      end
      out
    end

    def stat_for_key(k)
      case k
      when RX::RxSym, RX::RxStr then STAT_ALIASES[Tree.key_name(k).to_s.upcase]
      when Integer then LEGACY_STAT_ORDER[k]
      end
    end

    # Slot editable del valor de `stat` dentro del nodo (o nil si no existe).
    def slot(node, stat, base_path)
      case layout(node)
      when :hash
        i = node.pairs.index { |k, _| stat_for_key(k) == stat }
        return nil unless i

        Slot.new(node.pairs, :pair, i, base_path + Path.key(node.pairs[i][0]))
      when :array
        i = LEGACY_STAT_ORDER.index(stat)
        return nil if i.nil? || i >= node.items.size

        Slot.of_item(node, i, base_path)
      end
    end
  end

  module Ids
    module_function

    # Identificador "visible" de un nodo-id: Symbol -> nombre, Integer -> numero.
    def of(v)
      case v
      when RX::RxSym then v.name
      when Integer then v
      when RX::RxStr then v.text
      end
    end

    def style(v)
      case v
      when RX::RxSym then :symbol
      when Integer then :integer
      when RX::RxStr then :string
      end
    end

    # "OLDAMBER" -> "Oldamber", "SPECIAL_ATTACK" -> "Special Attack", 25 -> "#25".
    def pretty(id)
      case id
      when Integer then "##{id}"
      when String
        return id if id.empty?
        words = id.tr('_', ' ').split(' ')
        words.map { |w| w =~ /\A[A-Z0-9]+\z/ && w.length > 1 ? w.capitalize : w }.join(' ')
      else
        id.to_s
      end
    end
  end
end
