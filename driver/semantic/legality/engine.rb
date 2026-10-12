# =============================================================================
# engine.rb — Calcula flags de legalidad de entidades (Pokemon, entrenador,
# mochila, equipo) y el informe global (`check_legality`), con cache por revision.
# =============================================================================

require 'set'

module Sem
  module Legality
    Entity = Struct.new(:id, :kind, :node, :ref)

    class Engine
      BAG_ITEM_RULES = %w[bag_item_unknown bag_wrong_pocket key_item_multiple].freeze

      attr_reader :ctx

      def initialize(session)
        @session = session
        @model = Api.state!(session).model
        @ctx = Context.new(@model)
        @enabled = PokemonRules::RULES.select { |r| @ctx.can?(r.needs) }
      end

      # ── Entidades ─────────────────────────────────────────────────────────
      def entity_for_ref(ref)
        kind = ref.to_s.split('/').first
        case kind
        when 'trainer' then Entity.new(:trainer, :trainer, nil, 'trainer')
        when 'bag' then Entity.new(:bag, :bag, nil, 'bag')
        when 'party' then Entity.new(:party, :party, nil, 'party') if ref.to_s == 'party'
        end || pokemon_entity(ref)
      end

      def pokemon_entity(ref)
        return nil unless %w[party box].include?(ref.to_s.split('/').first) && ref.to_s.include?('/')

        found = @model.resolve_pokemon(ref)
        found && Entity.new(found[:node].object_id, :pokemon, found[:node], ref.to_s)
      end

      def flags_for(entity)
        case entity.kind
        when :pokemon then pokemon_flags(entity.node)
        when :trainer then TrainerRules.flags(@ctx)
        when :bag then BagRules.flags(@ctx).reject { |f| !@ctx.can?(:items) && BAG_ITEM_RULES.include?(f.code) }
        when :party then PartyRules.flags(@ctx)
        else []
        end
      end

      def pokemon_flags(pk)
        f = PokeFacts.read(pk)
        @enabled.flat_map { |r| r.fn.call(@ctx, f) || [] }
      end

      # ── Cobertura ─────────────────────────────────────────────────────────
      def coverage
        evaluated = []
        skipped = []
        PokemonRules::RULES.each do |r|
          if @ctx.can?(r.needs) then evaluated << r.code
          else skipped << { code: r.code, reason: @ctx.reason_for(r.needs) }
          end
        end
        BAG_ITEM_RULES.each do |code|
          if @ctx.can?(:items) then evaluated << code
          else skipped << { code: code, reason: @ctx.reason_for(:items) }
          end
        end
        evaluated += %w[trainer_money trainer_coins trainer_battle_points trainer_soot trainer_name_empty bag_qty_range
                        bag_duplicate_item party_size party_empty egg_only_party]
        if @ctx.can?(:player_name_limit) then evaluated << 'trainer_name'
        else skipped << { code: 'trainer_name', reason: @ctx.reason_for(:player_name_limit) }
        end
        status = GameData::Status.legality(@model.game, @model.calibration)
        { level: status[:level], reasons: status[:reasons], evaluated: evaluated, skipped: skipped }
      end

      # ── Todas las entidades ───────────────────────────────────────────────
      # [[ref, Entity], ...] de equipo, PC, entrenador, bolsa y el equipo como conjunto.
      def all_entities
        list = []
        @model.party_items.each_with_index { |pk, i| list << ["party/#{i}", pokemon_entity_for(pk, "party/#{i}")] if pk }
        @model.box_arrays.each_with_index do |(_box, _ivar, arr), bi|
          arr&.items&.each_with_index { |pk, si| list << ["box/#{bi}/#{si}", pokemon_entity_for(pk, "box/#{bi}/#{si}")] if pk }
        end
        list << ['trainer', Entity.new(:trainer, :trainer, nil, 'trainer')] if @model.binding(:trainer)
        list << ['bag', Entity.new(:bag, :bag, nil, 'bag')] if @model.binding(:bag)
        list << ['party', Entity.new(:party, :party, nil, 'party')] if @model.party_binding
        list
      end

      def pokemon_entity_for(pk, ref)
        Entity.new(pk.object_id, :pokemon, pk, ref)
      end

      # Entidad -> [Flag], de TODO el save.
      def check_all
        all_entities.map { |ref, ent| [ref, ent, flags_for(ent)] }
      end

      # { entity_id => Set(keys) } para el save completo (linea base de HeX al guardar).
      def snapshot_all
        check_all.to_h { |_ref, ent, flags| [ent.id, flags.map(&:key).to_set] }
      end

      # Informe global. `include_info` anade las flags informativas (PIDs repetidos...).
      def report(include_info: false, refs: nil)
        rows = check_all
        rows = rows.select { |ref, _e, _f| refs.include?(ref) } if refs && !refs.empty?
        flags = {}
        counts = Hash.new(0)
        illegal_refs = 0
        rows.each do |ref, _ent, list|
          visible = include_info ? list : list.reject { |f| f.severity == 'info' }
          next if visible.empty?

          flags[ref] = visible.map { |f| f.to_h(ref) }
          visible.each { |f| counts[f.severity] += 1 }
          illegal_refs += 1 if visible.any?(&:illegal?)
        end
        add_pid_duplicates(rows, flags, counts) if include_info
        { coverage: coverage,
          summary: { illegal: counts['illegal'], warning: counts['warning'], info: counts['info'], checked: rows.size,
                     refs: illegal_refs },
          flags: flags }
      end

      def add_pid_duplicates(rows, flags, counts)
        by_pid = Hash.new { |h, k| h[k] = [] }
        rows.each do |ref, ent, _| 
          next unless ent.kind == :pokemon

          pid = Tree.int_value(PokeFacts.first(ent.node, %w[@personalID @personal_id]))
          by_pid[pid] << ref if pid
        end
        by_pid.each_value do |refs|
          next if refs.size < 2

          refs.each do |ref|
            (flags[ref] ||= []) << Legality.flag('personal_id_duplicate', 'info', nil, count: refs.size).to_h(ref)
            counts['info'] += 1
          end
        end
      end
    end
  end
end
