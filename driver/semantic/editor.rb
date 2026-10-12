# =============================================================================
# editor.rb — Edicion semantica segura. Traduce operaciones de alto nivel
# (`set`, `pokemon.patch`, `bag.set`...) a Ops reversibles sobre el arbol,
# dentro de UNA transaccion del Journal:
#
#   aplicar -> validar el estado resultante -> si hay errores y no hay
#   `confirmed`, revertir todo y pedir confirmacion.
#
# Los valores se construyen con el mismo estilo del archivo (strings con su
# codificacion, simbolos internados) para conservar el roundtrip.
# =============================================================================

module Sem
  class Editor
    include EditorPc

    TRAINER_TYPES = {
      'name' => :str, 'id' => :int, 'trainer_type' => :id, 'gender' => :int, 'language' => :int,
      'money' => :int, 'coins' => :int, 'battle_points' => :int, 'soot' => :int
    }.freeze

    # Campo del patch -> ivars posibles (alias entre versiones) + tipo.
    POKEMON_FIELDS = {
      'species' => { ivars: %w[@species], type: :id, core: true },
      'level' => { ivars: %w[@level], type: :int, core: true },
      'exp' => { ivars: %w[@exp @experience], type: :int, core: true },
      'nickname' => { ivars: %w[@name @nickname], type: :str, nullable: true },
      'form' => { ivars: %w[@form], type: :int },
      'gender' => { ivars: %w[@gender @genderflag], type: :int },
      'shiny' => { ivars: %w[@shiny @shinyflag], type: :bool },
      'nature' => { ivars: %w[@nature @natureflag], type: :id },
      'ability' => { ivars: %w[@ability @abilityflag], type: :id },
      'abilityIndex' => { ivars: %w[@ability_index @abilityIndex], type: :int },
      'item' => { ivars: %w[@item], type: :id, nullable: true },
      'happiness' => { ivars: %w[@happiness], type: :int },
      'ball' => { ivars: %w[@poke_ball @ballused], type: :id },
      'status' => { ivars: %w[@status], type: :id },
      'hp' => { ivars: %w[@hp], type: :int, core: true }
    }.freeze

    def initialize(session)
      @session = session
      @doc = session.doc
      @state = Api.state!(session)
      @model = @state.model
      @resolved = @state.resolved
    end

    # ── API publica ───────────────────────────────────────────────────────────

    # `mode` ('hex' | 'hax'; por defecto el de la sesion):
    #   hex  rechaza (y revierte) toda edicion que INTRODUZCA ilegalidades segun el juego vinculado
    #   hax  aplica siempre y devuelve las flags nuevas para avisar sin bloquear
    def apply(ops, label: nil, mode: nil, **_ignored)
      ops = normalize_ops(ops)
      ensure_editable!
      mode = normalize_mode(mode)
      engine = Legality::Engine.new(@session)
      guard = Legality::Guard.new(@session, engine)
      before = guard.before_ops(ops)
      new_flags = []
      tx = nil
      begin
        tx = @session.journal.transaction(label || default_label(ops)) do |b|
          ops.each { |op| apply_one(b, op) }
          new_flags = guard.new_flags(before, b.tx.refs + ops.flat_map { |op| Legality::Guard.refs_of_op(op) })
          raise Legality::IllegalEdit, new_flags if mode == 'hex' && new_flags.any? { |_ref, f| f.illegal? }
        end
      rescue Legality::IllegalEdit => e
        return { applied: false, rejected: { code: 'illegal', mode: mode, flags: flag_dtos(e.flags) } }
      end
      return { applied: false, reason: 'no_changes', issues: [] } unless tx

      after_change(tx)
      { applied: true, undoId: tx.id, refs: tx.refs, issues: [], newFlags: flag_dtos(new_flags),
        pendingCount: @session.journal.pending_count, structural: @session.journal.structural?(tx) }
    end

    # Simula las ops (aplica, mide, revierte) y devuelve cambios + las flags que introducirian.
    def preview(ops, mode: nil)
      ops = normalize_ops(ops)
      mode = normalize_mode(mode)
      engine = Legality::Engine.new(@session)
      guard = Legality::Guard.new(@session, engine)
      before = guard.before_ops(ops)
      flags = []
      changes = []
      @session.journal.preview(default_label(ops)) do |b|
        ops.each { |op| apply_one(b, op) }
        flags = guard.new_flags(before, b.tx.refs + ops.flat_map { |op| Legality::Guard.refs_of_op(op) })
        changes = b.tx.ops.map(&:describe)
      end
      { changes: changes, newFlags: flag_dtos(flags), blocking: mode == 'hex' && flags.any? { |_ref, f| f.illegal? } }
    end

    def undo
      step(:undo)
    end

    def redo
      step(:redo)
    end

    # ── Interno ───────────────────────────────────────────────────────────────

    private

    def step(dir)
      tx = @session.journal.public_send(dir)
      return { applied: false, reason: 'nothing_to_do' } unless tx

      after_change(tx)
      { applied: true, direction: dir.to_s, tx: @session.journal.tx_summary(tx),
        pendingCount: @session.journal.pending_count, redoCount: @session.journal.redo_stack.size }
    end

    def normalize_mode(mode)
      m = (mode || @session.mode).to_s
      Legality::MODES.include?(m) ? m : Legality::DEFAULT_MODE
    end

    def flag_dtos(pairs)
      pairs.map { |ref, f| f.to_h(ref) }
    end

    def after_change(tx)
      return unless @session.journal.structural?(tx)

      @session.rebuild_collector!
      @state.invalidate_coverage!
    end

    # Confianza baja = solo lectura hasta que el usuario confirme la deteccion.
    def ensure_editable!
      return if @resolved.editable?

      raise DriverError.new('ReadOnlyProfile', 'la deteccion de la base no es fiable; confirmala antes de editar',
                            { confidence: @resolved.confidence, profileId: @resolved.profile.id })
    end

    def normalize_ops(ops)
      list = Array(ops)
      raise DriverError.new('ValidationError', 'no hay operaciones', { code: 'no_ops' }) if list.empty?

      list
    end

    def default_label(ops)
      first = ops.first
      key = ops.size == 1 ? "op.#{first['op']}" : 'op.multiple'
      { key: key, params: { ref: first['ref'] || first['from'] || first['index'], to: first['to'],
                            field: first['field'] || first['ivar'], count: ops.size } }
    end

    def apply_one(builder, op)
      case op['op']
      when 'set' then op_set(builder, op)
      when 'pokemon.patch' then op_pokemon_patch(builder, op)
      when 'bag.set' then op_bag_set(builder, op)
      when 'trainer.badge' then op_badge(builder, op)
      when 'extra.set' then op_extra_set(builder, op)
      when 'pokemon.move' then op_pokemon_move(builder, op)
      when 'pokemon.remove' then op_pokemon_remove(builder, op)
      when 'box.patch' then op_box_patch(builder, op)
      else raise DriverError.new('UnknownOp', "operacion desconocida: #{op['op'].inspect}", { op: op['op'] })
      end
    end

    # ── Valores ───────────────────────────────────────────────────────────────

    def type_error(field, expected)
      DriverError.new('ValidationError', "tipo invalido para #{field}",
                      { code: 'type_mismatch', field: field, expected: expected.to_s })
    end

    def id_style_default
      @resolved.facts.species_style || (@resolved.profile.ids == :integer ? :integer : :symbol)
    end

    def make_id(like, value, field)
      style = case like
              when RX::RxSym then :symbol
              when Integer then :integer
              else id_style_default
              end
      if style == :integer
        raise type_error(field, :int) unless value.is_a?(Integer)

        value
      else
        raise type_error(field, :str) unless value.is_a?(String) && !value.empty?

        @doc.sym(value)
      end
    end

    # Convierte `value` (JSON) en un nodo del mismo tipo que `old`.
    def coerce(old, value, type, field, nullable: false)
      return nil if value.nil? && (nullable || old.nil?) && type != :int
      raise type_error(field, type) if value.nil?

      case old
      when Integer, RX::RxBig
        raise type_error(field, :int) unless value.is_a?(Integer) || (value.is_a?(Float) && value == value.to_i)

        value.to_i
      when RX::RxFloat
        raise type_error(field, :float) unless value.is_a?(Numeric)

        RX::RxFloat.from_f(value.to_f)
      when RX::RxStr
        raise type_error(field, :str) unless value.is_a?(String)

        @doc.new_string(value, like: old)
      when RX::RxSym
        make_id(old, value, field)
      when true, false
        raise type_error(field, :bool) unless value == true || value == false

        value
      when nil
        case type
        when :int then (value.is_a?(Integer) ? value : raise(type_error(field, :int)))
        when :str then (value.is_a?(String) ? @doc.new_string(value) : raise(type_error(field, :str)))
        when :bool then (value == true || value == false ? value : raise(type_error(field, :bool)))
        when :id then make_id(nil, value, field)
        else raise type_error(field, type)
        end
      else
        raise type_error(field, type)
      end
    end

    def same?(a, b)
      UI.same_value?(a, b)
    end

    # Aplica un SetSlot solo si el valor realmente cambia.
    def set_slot(builder, slot, new_value, structural: false)
      return if same?(slot.get, new_value)

      builder.apply(SetSlot.new(slot, new_value, structural: structural))
    end

    # ── Entrenador ────────────────────────────────────────────────────────────

    def op_set(builder, op)
      ref = op['ref'].to_s
      field = op['field'].to_s
      raise DriverError.new('UnknownRef', "ref no soportado para set: #{ref}", { ref: ref }) unless ref == 'trainer'

      type = TRAINER_TYPES[field]
      slot = type && @model.trainer_slot(field)
      raise DriverError.new('FieldMissing', "esta base no tiene #{field}", { field: field }) unless slot

      set_slot(builder, slot, coerce(slot.get, op['value'], type, field))
      builder.touch('trainer')
    end

    def op_badge(builder, op)
      b = @resolved.binding(:trainer)
      arr = b && Tree.ivar(b.node, '@badges')
      idx = op['index'].to_i
      unless Tree.array?(arr) && idx >= 0 && idx < arr.items.size
        raise DriverError.new('FieldMissing', 'medalla inexistente', { field: "badges.#{idx}" })
      end
      raise type_error('badge', :bool) unless op['value'] == true || op['value'] == false

      slot = Slot.of_item(arr, idx, b.path + Path.attr('@badges'))
      set_slot(builder, slot, op['value'])
      builder.touch('trainer')
    end

    # ── Pokemon ───────────────────────────────────────────────────────────────

    def op_pokemon_patch(builder, op)
      ref = op['ref'].to_s
      found = @model.resolve_pokemon(ref)
      raise DriverError.new('PokemonNotFound', "no hay Pokemon en #{ref}", { ref: ref }) unless found

      pk = found[:node]
      path = found[:path]
      patch = op['patch'] || {}
      patch.each do |key, value|
        case key
        when 'iv' then patch_stats(builder, pk, path, '@iv', value, 'iv')
        when 'ev' then patch_stats(builder, pk, path, '@ev', value, 'ev')
        when 'moves' then patch_moves(builder, pk, path, value)
        else
          spec = POKEMON_FIELDS[key]
          raise DriverError.new('FieldMissing', "campo desconocido: #{key}", { field: key }) unless spec

          patch_scalar(builder, pk, path, key, spec, value)
        end
      end
      builder.touch(ref)
    end

    def patch_scalar(builder, pk, path, key, spec, value)
      name, pair = Tree.first_ivar(pk, spec[:ivars])
      if pair
        slot = Slot.of_ivar(pk, name, path)
        set_slot(builder, slot, coerce(slot.get, value, spec[:type], key, nullable: spec[:nullable]),
                 structural: false)
      elsif spec[:core]
        raise DriverError.new('FieldMissing', "este Pokemon no tiene #{key}", { field: key })
      else
        # El ivar no existe en este objeto (varia entre instancias): se agrega.
        node = coerce(nil, value, spec[:type], key, nullable: spec[:nullable])
        builder.apply(AddAttr.new(pk, @doc.sym(spec[:ivars].first), node, path))
      end
    end

    def patch_stats(builder, pk, path, ivar, values, label)
      node = Tree.ivar(pk, ivar)
      raise DriverError.new('FieldMissing', "este Pokemon no tiene #{ivar}", { field: label }) unless node

      values.each do |stat, v|
        canonical = STAT_ALIASES[stat.to_s.upcase]
        slot = canonical && StatMap.slot(node, canonical, path + Path.attr(ivar))
        raise DriverError.new('FieldMissing', "no existe #{label}.#{stat}", { field: "#{label}.#{stat}" }) unless slot

        set_slot(builder, slot, coerce(slot.get, v, :int, "#{label}.#{canonical}"))
      end
    end

    def move_template(pk)
      list = Tree.ivar(pk, '@moves')
      own = Tree.array?(list) && list.items.compact.first
      return own if own

      @resolved.scan.pokemon.each do |ref|
        m = Tree.ivar(ref.node, '@moves')
        first = Tree.array?(m) && m.items.compact.first
        return first if first
      end
      nil
    end

    def patch_moves(builder, pk, path, moves)
      list = Tree.ivar(pk, '@moves')
      raise DriverError.new('FieldMissing', 'este Pokemon no tiene @moves', { field: 'moves' }) unless Tree.array?(list)

      base = path + Path.attr('@moves')
      Array(moves).each do |m|
        slot_i = m['slot'].to_i
        if m['remove']
          raise DriverError.new('FieldMissing', 'movimiento inexistente', { field: "moves.#{slot_i}" }) if slot_i >= list.items.size

          builder.apply(ArrayRemove.new(list, slot_i, base))
          next
        end

        if slot_i < list.items.size && list.items[slot_i]
          patch_existing_move(builder, list.items[slot_i], base + Path.index(slot_i), m)
        elsif slot_i == list.items.size && slot_i < 4
          append_move(builder, pk, list, base, m)
        else
          raise DriverError.new('FieldMissing', 'movimiento inexistente', { field: "moves.#{slot_i}" })
        end
      end
    end

    MOVE_FIELDS = { 'id' => %w[@id], 'pp' => %w[@pp], 'ppUps' => %w[@ppup @ppUp] }.freeze

    def patch_existing_move(builder, move, move_path, patch)
      MOVE_FIELDS.each do |key, ivars|
        next unless patch.key?(key)

        name, pair = Tree.first_ivar(move, ivars)
        raise DriverError.new('FieldMissing', "el movimiento no tiene #{key}", { field: "moves.#{key}" }) unless pair

        slot = Slot.of_ivar(move, name, move_path)
        type = key == 'id' ? :id : :int
        set_slot(builder, slot, coerce(slot.get, patch[key], type, "moves.#{key}"))
      end
    end

    def append_move(builder, pk, list, base, patch)
      tpl = move_template(pk)
      raise DriverError.new('NoMoveTemplate', 'no hay un movimiento de referencia en el save', {}) unless tpl

      fresh = RxMarshal.deep_clone(tpl)
      new_path = base + Path.index(list.items.size)
      patch_existing_move(Journal::Builder.new(Journal::Tx.new(0, nil, [], [], Time.now)), fresh, new_path, patch)
      builder.apply(ArrayInsert.new(list, list.items.size, fresh, base))
    end

    # ── Bolsa ─────────────────────────────────────────────────────────────────

    def op_bag_set(builder, op)
      bag = @resolved.binding(:bag)
      raise DriverError.new('RoleNotFound', 'este save no tiene bolsa', { role: 'bag' }) unless bag

      pocket_i, item_id = resolve_bag_target(bag, op)
      pocket = bag.array.items[pocket_i]
      raise DriverError.new('FieldMissing', "bolsillo inexistente: #{pocket_i}", { field: "bag.#{pocket_i}" }) unless Tree.array?(pocket)

      qty = op['qty']
      raise type_error('qty', :int) unless qty.is_a?(Integer)

      pocket_path = bag.path + Path.attr(bag.ivar) + Path.index(pocket_i)
      idx = pocket.items.index { |pair| Shapes.item_pair?(pair) && Ids.of(pair.items[0]).to_s == item_id.to_s }
      if idx
        if qty <= 0
          builder.apply(ArrayRemove.new(pocket, idx, pocket_path))
        else
          pair = pocket.items[idx]
          set_slot(builder, Slot.of_item(pair, 1, pocket_path + Path.index(idx)), qty)
        end
      elsif qty > 0
        like = pocket.items.find { |p| Shapes.item_pair?(p) }&.items&.first
        like ||= bag.array.items.flat_map { |p| Tree.array?(p) ? p.items : [] }.find { |p| Shapes.item_pair?(p) }&.items&.first
        pair = RX::RxArr.new([make_id(like, coerce_item_id(like, item_id), 'item'), qty])
        builder.apply(ArrayInsert.new(pocket, pocket.items.size, pair, pocket_path))
      end
      builder.touch('bag')
    end

    def coerce_item_id(like, item_id)
      return item_id.to_i if like.is_a?(Integer) && item_id.to_s =~ /\A\d+\z/

      item_id
    end

    # => [indice_de_bolsillo, id_de_objeto]
    def resolve_bag_target(bag, op)
      if op['ref'].to_s.start_with?('bag/')
        _, p, s = op['ref'].split('/')
        pair = bag.array.items[p.to_i]&.then { |arr| Tree.array?(arr) ? arr.items[s.to_i] : nil }
        raise DriverError.new('FieldMissing', 'ranura inexistente', { field: op['ref'] }) unless Shapes.item_pair?(pair)

        [p.to_i, Ids.of(pair.items[0])]
      else
        raise type_error('item', :str) if op['id'].nil?

        [op['pocket'].to_i, op['id']]
      end
    end

    # ── Extras (ivars sin control propio) ─────────────────────────────────────

    def entity_node(ref)
      case ref.to_s.split('/').first
      when 'trainer' then (b = @resolved.binding(:trainer)) && [b.node, b.path]
      when 'bag' then (b = @resolved.binding(:bag)) && [b.node, b.path]
      when 'storage' then (b = @resolved.binding(:storage)) && [b.node, b.path]
      when 'party', 'box'
        f = @model.resolve_pokemon(ref)
        f && [f[:node], f[:path]]
      end
    end

    def op_extra_set(builder, op)
      ref = op['ref'].to_s
      node, path = entity_node(ref)
      raise DriverError.new('UnknownRef', "ref desconocido: #{ref}", { ref: ref }) unless node

      slot = Slot.of_ivar(node, op['ivar'].to_s, path)
      raise DriverError.new('FieldMissing', "no existe #{op['ivar']}", { field: op['ivar'] }) unless slot
      raise DriverError.new('NotEditable', "#{op['ivar']} no es editable aqui", { field: op['ivar'] }) unless Tree.leaf?(slot.get)

      set_slot(builder, slot, coerce(slot.get, op['value'], :str, op['ivar']))
      builder.touch(ref)
    end
  end
end
