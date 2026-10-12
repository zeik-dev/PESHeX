# =============================================================================
# editor_extras.rb — Operaciones del Editor para Pokedex, mundo (interruptores y
# variables), acciones rapidas sobre un Pokemon (curar, recalcular, subir de
# nivel) y creacion de Pokemon (importar / clonar). Todas reversibles.
# =============================================================================

module Sem
  module EditorExtras
    STAT_IVARS = { 'HP' => %w[@totalhp], 'ATTACK' => %w[@attack], 'DEFENSE' => %w[@defense],
                   'SPECIAL_ATTACK' => %w[@spatk], 'SPECIAL_DEFENSE' => %w[@spdef], 'SPEED' => %w[@speed] }.freeze

    private

    # ── Pokedex ───────────────────────────────────────────────────────────────

    def op_pokedex_set(builder, op)
      b = @model.binding(:pokedex)
      raise DriverError.new('RoleNotFound', 'este save no tiene Pokedex', { role: 'pokedex' }) unless b

      id = op['id'].to_s
      want_owned = op.key?('owned') ? !!op['owned'] : nil
      want_seen = op.key?('seen') ? !!op['seen'] : nil
      want_seen = true if want_owned == true
      want_owned = false if want_seen == false
      set_dex_flag(builder, b, '@seen', id, want_seen) unless want_seen.nil?
      set_dex_flag(builder, b, '@owned', id, want_owned) unless want_owned.nil?
      builder.touch('pokedex')
    end

    def op_pokedex_bulk(builder, op)
      ids = Array(op['ids']).map(&:to_s)
      raise DriverError.new('ValidationError', 'faltan las especies', { code: 'no_ids' }) if ids.empty?

      mode = op['mode'].to_s
      ids.each do |id|
        sub = case mode
              when 'seen_all' then { 'seen' => true }
              when 'owned_all' then { 'owned' => true }
              when 'clear_all' then { 'seen' => false }
              when 'unown_all' then { 'owned' => false }
              else raise DriverError.new('ValidationError', "modo desconocido: #{mode}", { code: 'unknown_bulk', mode: mode })
              end
        op_pokedex_set(builder, sub.merge('id' => id))
      end
    end

    def dex_key_like(hash, id)
      sample = hash.pairs.first&.first
      case sample
      when RX::RxStr then @doc.new_string(id, like: sample)
      when Integer then id =~ /\A\d+\z/ ? id.to_i : @doc.sym(id)
      else @doc.sym(id)
      end
    end

    def set_dex_flag(builder, b, ivar, id, value)
      node = Tree.ivar(b.node, ivar)
      path = b.path + Path.attr(ivar)
      raise DriverError.new('FieldMissing', "el Pokedex no tiene #{ivar}", { field: ivar }) if node.nil?

      if Tree.hash?(node)
        idx = node.pairs.index { |k, _| Tree.key_name(k) == id }
        if idx && value
          set_slot(builder, Slot.new(node.pairs, :pair, idx, path + Path.key(node.pairs[idx][0])), true)
        elsif idx
          builder.apply(HashDelete.new(node, idx, path))
        elsif value
          builder.apply(HashPut.new(node, dex_key_like(node, id), true, path))
        end
      elsif Tree.array?(node)
        i = id.to_i
        raise DriverError.new('FieldMissing', "especie fuera del Pokedex: #{id}", { field: id }) unless id =~ /\A\d+\z/ && i < node.items.size

        set_slot(builder, Slot.of_item(node, i, path), value)
      end
    end

    # ── Mundo: interruptores y variables ──────────────────────────────────────

    def op_world_set(builder, op, kind)
      found = Extras.new(@session).world_data(kind)
      raise DriverError.new('RoleNotFound', "este save no tiene #{kind}", { role: kind }) unless found

      arr, path = found
      id = op['id']
      unless id.is_a?(Integer) && id.positive? && id < arr.items.size
        raise DriverError.new('FieldMissing', "no existe #{kind}[#{id.inspect}]", { field: "#{kind}.#{id}" })
      end

      slot = Slot.of_item(arr, id, path)
      old = slot.get
      value = op['value']
      new_node =
        if kind == 'switches'
          raise type_error('switch', :bool) unless value == true || value == false

          value
        else
          raise DriverError.new('NotEditable', "#{kind}[#{id}] no es un valor simple", { field: "#{kind}.#{id}" }) unless Tree.leaf?(old)

          variable_node(old, value, "variables.#{id}")
        end
      set_slot(builder, slot, new_node)
      builder.touch("world/#{kind}/#{id}")
    end

    def variable_node(old, value, field)
      case value
      when nil then nil
      when true, false then value
      when Integer then value
      when Float then RX::RxFloat.from_f(value)
      when String then @doc.new_string(value, like: old.is_a?(RX::RxStr) ? old : nil)
      else raise type_error(field, :int)
      end
    end

    # ── Acciones rapidas sobre un Pokemon ─────────────────────────────────────

    def pokemon_for_op(op)
      ref = op['ref'].to_s
      found = @model.resolve_pokemon(ref)
      raise DriverError.new('PokemonNotFound', "no hay Pokemon en #{ref}", { ref: ref }) unless found

      [ref, found[:node], found[:path]]
    end

    def set_ivar(builder, pk, path, names, value)
      name, pair = Tree.first_ivar(pk, names)
      return false unless pair

      slot = Slot.of_ivar(pk, name, path)
      set_slot(builder, slot, coerce(slot.get, value, :int, name))
      true
    end

    def op_pokemon_heal(builder, op)
      ref, pk, path = pokemon_for_op(op)
      f = PokeFacts.read(pk)
      total = f.stats['HP']
      set_ivar(builder, pk, path, %w[@hp], total) if total
      status_name, status_pair = Tree.first_ivar(pk, %w[@status])
      if status_pair && !status_pair.last.nil?
        slot = Slot.of_ivar(pk, status_name, path)
        old = slot.get
        none = old.is_a?(Integer) ? 0 : make_id(old, 'NONE', 'status')
        set_slot(builder, slot, none)
      end
      set_ivar(builder, pk, path, %w[@statusCount], 0)
      heal_moves(builder, pk, path)
      builder.touch(ref)
    end

    def heal_moves(builder, pk, path)
      game = @session.game
      list = Tree.ivar(pk, '@moves')
      return unless game && Tree.array?(list)

      list.items.each_with_index do |m, i|
        next unless Tree.object?(m)

        data = game.move(Ids.of(Tree.ivar(m, '@id')))
        next unless data&.total_pp

        ppup = Tree.int_value(first_of(m, %w[@ppup @ppUp])) || 0
        max = data.total_pp + (data.total_pp * ppup / 5)
        pp_name, pp_pair = Tree.first_ivar(m, %w[@pp])
        next unless pp_pair

        slot = Slot.of_ivar(m, pp_name, "#{path}#{Path.attr('@moves')}#{Path.index(i)}")
        set_slot(builder, slot, coerce(slot.get, max, :int, 'pp'))
      end
    end

    def first_of(obj, names)
      Tree.first_ivar(obj, names)&.last&.last
    end

    def stats_recalc_available?
      @model.calibration&.dig(:stats, :status) == 'ok' && @session.game&.species?
    end

    def require_recalc!
      return if stats_recalc_available?

      raise DriverError.new('RecalcUnavailable', 'no se pueden recalcular las estadisticas con los datos disponibles',
                            { reason: @session.game ? 'stats_untrusted' : 'no_game_folder' })
    end

    def recalc_stats!(builder, pk, path)
      f = PokeFacts.read(pk)
      base = @session.game.base_stats(f.species, f.form)
      raise DriverError.new('RecalcUnavailable', 'faltan las estadisticas base de la especie', { reason: 'species_unknown' }) if base.size < 6
      raise DriverError.new('RecalcUnavailable', 'faltan nivel, IV o EV', { reason: 'incomplete' }) if f.level.nil? || f.iv.values.any?(&:nil?) || f.ev.values.any?(&:nil?)

      stats = GameData::Tables.calc_all(base, f.level, f.iv, f.ev, f.nature_for_stats || f.nature)
      STAT_IVARS.each { |stat, names| set_ivar(builder, pk, path, names, stats[stat]) }
      hp_name, hp_pair = Tree.first_ivar(pk, %w[@hp])
      if hp_pair && Tree.int_value(hp_pair.last) && Tree.int_value(hp_pair.last) > stats['HP']
        slot = Slot.of_ivar(pk, hp_name, path)
        set_slot(builder, slot, stats['HP'])
      end
      stats
    end

    def op_pokemon_recalc(builder, op)
      ref, pk, path = pokemon_for_op(op)
      require_recalc!
      recalc_stats!(builder, pk, path)
      builder.touch(ref)
    end

    # Cambia el nivel y mantiene coherente la experiencia (y las estadisticas si se pueden calcular).
    def op_pokemon_level(builder, op)
      ref, pk, path = pokemon_for_op(op)
      level = op['level']
      raise type_error('level', :int) unless level.is_a?(Integer)

      f = PokeFacts.read(pk)
      old_total = f.stats['HP']
      set_slot(builder, Slot.of_ivar(pk, *level_ivar(pk), path), level)
      sync_exp_to_level!(builder, pk, path)
      if stats_recalc_available? && f.level
        stats = recalc_stats!(builder, pk, path)
        hp = f.hp
        if hp && old_total && stats['HP'] > old_total
          set_ivar(builder, pk, path, %w[@hp], [hp + (stats['HP'] - old_total), stats['HP']].min)
        end
      end
      builder.touch(ref)
    end

    # Deja la experiencia en el minimo del nivel actual cuando el juego conoce la especie.
    def sync_exp_to_level!(builder, pk, path)
      f = PokeFacts.read(pk)
      game = @session.game
      return unless game&.species? && f.species && f.level && game.species_entry(f.species, f.form)

      rate = game.growth_rate(f.species, f.form)
      set_ivar(builder, pk, path, %w[@exp @experience], GameData::Tables.exp_at(rate, f.level))
    end

    def level_ivar(pk)
      name, pair = Tree.first_ivar(pk, %w[@level])
      raise DriverError.new('FieldMissing', 'este Pokemon no tiene @level', { field: 'level' }) unless pair

      [name]
    end

    # ── Crear Pokemon: importar y clonar ──────────────────────────────────────

    def free_target(arg)
      return parse_target(arg) unless arg.to_s == 'auto'

      current = Tree.int_value(Tree.ivar(@resolved.binding(:storage)&.node, '@currentBox')) || 0
      boxes = @model.box_arrays
      order = (0...boxes.size).to_a.rotate(current)
      order.each do |bi|
        arr = boxes[bi][2]
        i = arr&.items&.index(nil)
        return EditorPc::Spot.new(:box, bi, i) if i
      end
      raise DriverError.new('PcFull', 'no queda ninguna casilla libre en el PC', {})
    end

    def parse_target(ref)
      spot = parse_spot(ref)
      if spot.kind == :box
        raise DriverError.new('SlotOccupied', "la casilla #{ref} no esta vacia", { ref: ref }) unless spot_node(spot).nil?
      else
        size = party_size
        raise DriverError.new('SlotOccupied', 'solo se puede agregar al final del equipo', { ref: ref }) if spot.index != size
        raise DriverError.new('PartyFull', 'el equipo esta lleno', { max: @model.limits[:partySize] }) if size >= @model.limits[:partySize]
      end
      spot
    end

    def spot_ref(spot)
      spot.kind == :party ? "party/#{spot.index}" : "box/#{spot.box}/#{spot.index}"
    end

    def place_new(builder, node, spot)
      if spot.kind == :party
        builder.apply(ArrayInsert.new(party_binding!.array, spot.index, node, party_array_path))
      else
        builder.apply(SetSlot.new(spot_slot(spot), node))
      end
      builder.touch(spot_ref(spot))
      builder.touch('storage')
    end

    def new_personal_id
      used = @resolved.scan.pokemon.filter_map { |r| Tree.int_value(PokeFacts.first(r.node, %w[@personalID @personal_id])) }.to_set
      loop do
        id = Random.rand(1..0xFFFF_FFFF)
        return id unless used.include?(id)
      end
    end

    def scratch_builder
      Journal::Builder.new(Journal::Tx.new(0, nil, [], [], Time.now))
    end

    # Plantilla: otro Pokemon de la misma especie si lo hay; si no, el primero del equipo o cualquiera del save.
    def pokemon_template(species)
      same = @resolved.scan.pokemon.find { |r| Ids.of(PokeFacts.first(r.node, %w[@species])).to_s == species.to_s }
      (same || @resolved.scan.pokemon.first)&.node
    end

    def renew_personal_id(pk, path)
      name, pair = Tree.first_ivar(pk, %w[@personalID @personal_id])
      return unless pair

      slot = Slot.of_ivar(pk, name, path)
      slot.set(coerce(slot.get, new_personal_id, :int, name))
    end

    def op_pokemon_clone(builder, op)
      ref, pk, = pokemon_for_op(op)
      spot = free_target(op['to'] || 'auto')
      clone = RxMarshal.deep_clone(pk)
      renew_personal_id(clone, spot_ref(spot))
      place_new(builder, clone, spot)
      builder.touch(ref)
    end

    # Datos (importados de JSON/Showdown o creados a mano): ver Transfer.export para el formato.
    def op_pokemon_add(builder, op)
      data = validate_import_data(op['data'])
      species = data['species']
      raise DriverError.new('ValidationError', 'falta la especie', { code: 'no_species' }) if species.nil? || species.to_s.empty?

      tpl = pokemon_template(species)
      raise DriverError.new('NoPokemonTemplate', 'no hay ningun Pokemon en el save para usar de plantilla', {}) unless tpl

      spot = free_target(op['to'] || 'auto')
      clone = RxMarshal.deep_clone(tpl)
      path = spot_ref(spot)
      renew_personal_id(clone, path)
      moves = data['moves']
      patch = data.slice(*(Editor::POKEMON_FIELDS.keys + %w[iv ev]))
      replace_moves(clone, moves) if moves
      scratch = scratch_builder
      apply_patch(scratch, clone, path, patch)
      sync_exp_to_level!(scratch, clone, path) if patch.key?('level') && !patch.key?('exp')
      if data['recalc'] != false && stats_recalc_available?
        begin
          recalc_stats!(scratch, clone, path)
          set_ivar(scratch, clone, path, %w[@hp], PokeFacts.read(clone).stats['HP']) if data['hp'].nil?
        rescue DriverError
          nil # sin datos suficientes: se deja como vino de la plantilla
        end
      end
      place_new(builder, clone, spot)
    end

    # La forma de los datos importados (viene de texto/JSON que puede estar editado a mano): un error claro
    # en lugar de un NoMethodError dentro de la operacion.
    def validate_import_data(data)
      bad = ->(code, what) { raise DriverError.new('ValidationError', "datos de importacion no validos: #{what}", { code: code }) }
      bad.call('bad_data', 'se esperaba un objeto') unless data.is_a?(Hash)
      %w[iv ev].each { |k| bad.call("bad_#{k}", k) unless data[k].nil? || data[k].is_a?(Hash) }
      moves = data['moves']
      unless moves.nil? || (moves.is_a?(Array) && moves.all? { |m| m.is_a?(Hash) })
        bad.call('bad_moves', 'moves')
      end
      data
    end

    # Sustituye TODOS los movimientos del clon (la lista nueva sale de los del propio nodo como plantilla).
    def replace_moves(pk, moves)
      list = Tree.ivar(pk, '@moves')
      raise DriverError.new('FieldMissing', 'este Pokemon no tiene @moves', { field: 'moves' }) unless Tree.array?(list)

      tpl = list.items.compact.first || move_template(pk)
      raise DriverError.new('NoMoveTemplate', 'no hay un movimiento de referencia en el save', {}) unless tpl

      max = @model.limits[:maxMoves]
      fresh = Array(moves).first(max).map do |m|
        node = RxMarshal.deep_clone(tpl)
        patch_existing_move(scratch_builder, node, '', { 'id' => m['id'], 'pp' => m['pp'], 'ppUps' => m['ppUps'] }.compact)
        node
      end
      list.items.replace(fresh)
    end
  end
end
