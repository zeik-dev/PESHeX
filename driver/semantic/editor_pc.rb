# =============================================================================
# editor_pc.rb — Operaciones de PC/equipo del Editor: mover o intercambiar
# Pokemon entre cajas y equipo, liberar y editar cajas (nombre, fondo).
#
# Los NODOS no se clonan: un Pokemon movido es el mismo objeto del arbol en otro
# lugar, asi que "mover + deshacer" devuelve bytes identicos (y un Pokemon
# compartido con otra parte del save, como .variables, sigue siendo el mismo).
#
# Refs de lugar: `party/N` y `box/B/S`. `party/N` con N = tamano del equipo es
# "al final del equipo" (solo para entrar desde una caja).
# =============================================================================

module Sem
  module EditorPc
    Spot = Struct.new(:kind, :box, :index)

    private

    def parse_spot(ref)
      kind, a, b = ref.to_s.split('/')
      case kind
      when 'party'
        raise DriverError.new('UnknownRef', "ref desconocido: #{ref}", { ref: ref.to_s }) unless a =~ /\A\d+\z/

        Spot.new(:party, nil, a.to_i)
      when 'box'
        raise DriverError.new('UnknownRef', "ref desconocido: #{ref}", { ref: ref.to_s }) unless a =~ /\A\d+\z/ && b =~ /\A\d+\z/

        Spot.new(:box, a.to_i, b.to_i)
      else
        raise DriverError.new('UnknownRef', "ref desconocido: #{ref}", { ref: ref.to_s })
      end
    end

    def party_binding!
      b = @model.party_binding
      raise DriverError.new('RoleNotFound', 'este save no tiene equipo', { role: 'trainer' }) unless b

      b
    end

    def party_array_path
      b = party_binding!
      "#{b.path}#{Path.attr(b.ivar)}"
    end

    def box_array_for(spot)
      _box, ivar, arr = @model.box_arrays[spot.box]
      unless arr && spot.index < arr.items.size
        raise DriverError.new('UnknownRef', "no existe la casilla box/#{spot.box}/#{spot.index}", { ref: "box/#{spot.box}/#{spot.index}" })
      end

      [arr, @model.box_path(spot.box) + Path.attr(ivar)]
    end

    # Slot editable del lugar (equipo: indice existente; caja: casilla).
    def spot_slot(spot)
      if spot.kind == :party
        Slot.of_item(party_binding!.array, spot.index, party_array_path)
      else
        arr, path = box_array_for(spot)
        Slot.of_item(arr, spot.index, path)
      end
    end

    def spot_node(spot)
      if spot.kind == :party
        party_binding!.array.items[spot.index]
      else
        box_array_for(spot).first.items[spot.index]
      end
    end

    def party_size
      party_binding!.array.items.size
    end

    def op_pokemon_move(builder, op)
      from = parse_spot(op['from'])
      to = parse_spot(op['to'])
      return if from == to

      src = spot_node(from)
      raise DriverError.new('PokemonNotFound', "no hay Pokemon en #{op['from']}", { ref: op['from'] }) unless src

      limit = @model.limits[:partySize]
      if from.kind == :party && to.kind == :party
        raise DriverError.new('UnknownRef', 'destino fuera del equipo', { ref: op['to'] }) if to.index >= party_size

        swap_slots(builder, from, to)
      elsif from.kind == :box && to.kind == :box
        swap_slots(builder, from, to)
      elsif from.kind == :party
        move_party_to_box(builder, from, to)
      else
        move_box_to_party(builder, from, to, limit)
      end
      builder.touch(op['from'])
      builder.touch(op['to'])
      builder.touch('storage')
    end

    # Dos casillas intercambian su contenido (si el destino esta vacio, es un simple movimiento).
    def swap_slots(builder, from, to)
      a = spot_slot(from)
      b = spot_slot(to)
      a_val = a.get
      b_val = b.get
      builder.apply(SetSlot.new(b, a_val))
      builder.apply(SetSlot.new(a, b_val))
    end

    def move_party_to_box(builder, from, to)
      dst_slot = spot_slot(to)
      if dst_slot.get.nil?
        if party_size <= 1
          raise DriverError.new('PartyTooSmall', 'el equipo no puede quedar vacio', { min: 1 })
        end

        builder.apply(SetSlot.new(dst_slot, spot_node(from)))
        builder.apply(ArrayRemove.new(party_binding!.array, from.index, party_array_path))
      else
        swap_slots(builder, from, to)
      end
    end

    def move_box_to_party(builder, from, to, limit)
      size = party_size
      if to.index >= size
        raise DriverError.new('PartyFull', 'el equipo esta lleno', { max: limit }) if size >= limit

        src_slot = spot_slot(from)
        builder.apply(ArrayInsert.new(party_binding!.array, size, src_slot.get, party_array_path))
        builder.apply(SetSlot.new(src_slot, nil))
      else
        swap_slots(builder, from, to)
      end
    end

    # Liberar: quita el Pokemon (equipo: lo saca de la lista; caja: vacia la casilla).
    def op_pokemon_remove(builder, op)
      spot = parse_spot(op['ref'])
      node = spot_node(spot)
      raise DriverError.new('PokemonNotFound', "no hay Pokemon en #{op['ref']}", { ref: op['ref'] }) unless node

      if spot.kind == :party
        raise DriverError.new('PartyTooSmall', 'el equipo no puede quedar vacio', { min: 1 }) if party_size <= 1

        builder.apply(ArrayRemove.new(party_binding!.array, spot.index, party_array_path))
      else
        builder.apply(SetSlot.new(spot_slot(spot), nil))
      end
      builder.touch(op['ref'])
      builder.touch('storage')
    end

    # Nombre y fondo de una caja.
    def op_box_patch(builder, op)
      bi = op['index'].to_i
      box = @model.box_arrays[bi]&.first
      raise DriverError.new('UnknownRef', "no existe la caja #{bi}", { ref: "box/#{bi}" }) unless box

      base = @model.box_path(bi)
      { 'name' => ['@name', :str], 'background' => ['@background', :int] }.each do |key, (ivar, type)|
        next unless op.key?(key)

        slot = Slot.of_ivar(box, ivar, base)
        raise DriverError.new('FieldMissing', "la caja no tiene #{ivar}", { field: "box.#{key}" }) unless slot

        set_slot(builder, slot, coerce(slot.get, op[key], type, "box.#{key}"))
      end
      builder.touch('storage')
    end
  end
end
