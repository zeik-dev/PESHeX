# =============================================================================
# rules_misc.rb — Reglas del entrenador, la mochila y el equipo como conjunto.
# =============================================================================

module Sem
  module Legality
    module TrainerRules
      FIELDS = {
        'money' => :maxMoney, 'coins' => :maxCoins, 'battle_points' => :maxBattlePoints, 'soot' => :maxSoot
      }.freeze

      module_function

      def flags(ctx)
        m = ctx.model
        out = []
        FIELDS.each do |field, limit|
          v = Tree.int_value(m.trainer_value(field))
          next if v.nil?

          max = ctx.limits[limit]
          out << Legality.flag("trainer_#{field}", 'illegal', nil, value: v, min: 0, max: max) if v.negative? || v > max
        end
        name = Tree.text(m.trainer_value('name'))
        if name && ctx.can?(:player_name_limit)
          max = ctx.limits[:maxPlayerName]
          out << Legality.flag('trainer_name', 'illegal', nil, length: name.length, max: max) if name.length > max
        end
        out << Legality.flag('trainer_name_empty', 'warning') if name && name.strip.empty?
        out
      end
    end

    module BagRules
      module_function

      # Rangos por casilla (basicos) y, con los objetos del juego, existencia y bolsillo.
      def flags(ctx)
        bag = ctx.model.bag_view
        return [] unless bag

        max = ctx.limits[:bagPerSlot]
        out = []
        use_items = ctx.can?(:items)
        engine_pockets = bag[:layout] != 'flat'
        bag[:pockets].each do |pocket|
          seen = Hash.new(0)
          pocket[:slots].each do |s|
            id = s[:id].to_s
            seen[id] += 1
            out << Legality.flag('bag_qty_range', 'illegal', id, qty: s[:qty], min: 1, max: max) if s[:qty] && (s[:qty] < 1 || s[:qty] > max)
            next unless use_items

            item = ctx.game.item(s[:id])
            if item.nil?
              out << Legality.flag('bag_item_unknown', 'illegal', id)
              next
            end
            if engine_pockets && item.pocket && pocket[:index].between?(1, 8) && item.pocket != pocket[:index]
              out << Legality.flag('bag_wrong_pocket', 'warning', id, pocket: pocket[:index], expected: item.pocket)
            end
            if item.pocket == 8 && s[:qty].to_i > 1
              out << Legality.flag('key_item_multiple', 'warning', id, qty: s[:qty])
            end
          end
          seen.each { |id, n| out << Legality.flag('bag_duplicate_item', 'warning', id, count: n) if n > 1 }
        end
        out
      end
    end

    module PartyRules
      module_function

      def flags(ctx)
        m = ctx.model
        items = m.party_items.compact
        return [] unless m.party_binding

        out = []
        limit = ctx.limits[:partySize]
        out << Legality.flag('party_size', 'illegal', nil, count: items.size, max: limit) if items.size > limit
        out << Legality.flag('party_empty', 'illegal') if items.empty?
        if items.any? && items.all? { |pk| PokeFacts.read(pk).egg }
          out << Legality.flag('egg_only_party', 'warning')
        end
        out
      end
    end

    module DexRules
      module_function

      # Especies del Pokedex que el juego no conoce (ilegal) y capturadas sin haberlas visto (aviso).
      def flags(ctx, session)
        dex = Extras.new(session).pokedex
        return [] unless dex[:available] && dex[:layout] == 'hash'

        out = []
        if ctx.can?(:species)
          (dex[:seen] | dex[:owned]).each do |id|
            out << Legality.flag('dex_species_unknown', 'illegal', id) unless ctx.game.base_species(id)
          end
        end
        (dex[:owned] - dex[:seen]).each { |id| out << Legality.flag('dex_owned_not_seen', 'warning', id) }
        out
      end
    end
  end
end
