# =============================================================================
# ops.rb — Operaciones REVERSIBLES sobre el arbol de nodos. Cada edicion (del
# modo semantico o del modo Avanzado) es una Op: sabe aplicarse y deshacerse
# restaurando los MISMOS nodos originales (identidad incluida), asi que
# "editar + deshacer todo" devuelve bytes identicos.
# =============================================================================

module Sem
  class Op
    attr_reader :path

    # ¿Cambia la estructura (cantidad/identidad de campos)?
    def structural?
      false
    end

    def apply!
      raise NotImplementedError
    end

    def revert!
      raise NotImplementedError
    end

    # Descriptor serializable para el panel "Cambios".
    def describe
      raise NotImplementedError
    end
  end

  # Cambia el valor de un Slot (hoja o reemplazo de nodo).
  class SetSlot < Op
    attr_reader :slot, :old, :new

    def initialize(slot, new_value, structural: false)
      @slot = slot
      @old = slot.get
      @new = new_value
      @path = slot.path
      @structural = structural
    end

    def structural?
      @structural
    end

    def apply!
      @slot.set(@new)
    end

    def revert!
      @slot.set(@old)
    end

    def describe
      { op: 'set', path: @path, old: value_summary(@old), new: value_summary(@new) }
    end
  end

  # Inserta un elemento en un array.
  class ArrayInsert < Op
    def initialize(array_node, index, value, path)
      @array = array_node
      @index = index
      @value = value
      @path = path
    end

    def structural?
      true
    end

    def apply!
      @array.items.insert(@index, @value)
    end

    def revert!
      @array.items.delete_at(@index)
    end

    def describe
      { op: 'insert', path: "#{@path}[#{@index}]", old: { kind: 'nil', display: '—' }, new: value_summary(@value) }
    end
  end

  # Quita un elemento de un array (conserva el nodo para poder restaurarlo).
  class ArrayRemove < Op
    def initialize(array_node, index, path)
      @array = array_node
      @index = index
      @removed = array_node.items[index]
      @path = path
    end

    def structural?
      true
    end

    def apply!
      @array.items.delete_at(@index)
    end

    def revert!
      @array.items.insert(@index, @removed)
    end

    def describe
      { op: 'remove', path: "#{@path}[#{@index}]", old: value_summary(@removed), new: { kind: 'nil', display: '—' } }
    end
  end

  # Agrega un ivar que el objeto no tenia (p. ej. @nature_for_stats).
  class AddAttr < Op
    def initialize(object_node, sym_node, value, path)
      @object = object_node
      @pair = [sym_node, value]
      @path = path
    end

    def structural?
      true
    end

    def apply!
      @object.attrs << @pair
    end

    def revert!
      @object.attrs.delete_if { |p| p.equal?(@pair) }
    end

    def describe
      { op: 'add_attr', path: "#{@path}#{Path.attr(@pair[0].name)}", old: { kind: 'nil', display: '—' },
        new: value_summary(@pair[1]) }
    end
  end

  # Agrega un par clave/valor a un RxHash (p. ej. una especie vista en el Pokedex).
  class HashPut < Op
    def initialize(hash_node, key_node, value, path)
      @hash = hash_node
      @pair = [key_node, value]
      @path = path
    end

    def structural?
      true
    end

    def apply!
      @hash.pairs << @pair
    end

    def revert!
      @hash.pairs.delete_if { |pr| pr.equal?(@pair) }
    end

    def describe
      { op: 'hash_put', path: "#{@path}#{Path.key(@pair[0])}", old: { kind: 'nil', display: '—' }, new: value_summary(@pair[1]) }
    end
  end

  # Quita un par de un RxHash (conserva el par para poder restaurarlo en su posicion).
  class HashDelete < Op
    def initialize(hash_node, index, path)
      @hash = hash_node
      @index = index
      @pair = hash_node.pairs[index]
      @path = path
    end

    def structural?
      true
    end

    def apply!
      @hash.pairs.delete_at(@index)
    end

    def revert!
      @hash.pairs.insert(@index, @pair)
    end

    def describe
      { op: 'hash_delete', path: "#{@path}#{Path.key(@pair[0])}", old: value_summary(@pair[1]), new: { kind: 'nil', display: '—' } }
    end
  end
end
