# =============================================================================
# tree.rb — Utilidades para leer/escribir el arbol de nodos RxMarshal sin pasar
# por el Collector (que aplana ~320k campos y tarda segundos).
#
# La gramatica de rutas (`Sem::Path`) es la MISMA que usa el Collector
# (edit_rxdata.rb: attr_path/key_path), para que `fieldPath` de la capa
# semantica coincida con las rutas de la vista Avanzado.
# =============================================================================

module Sem
  RX = RxMarshal

  module Tree
    module_function

    def object?(v)
      v.is_a?(RX::RxObj) || v.is_a?(RX::RxStruct)
    end

    def class_name(v)
      v.respond_to?(:class_name) ? v.class_name : nil
    end

    def array?(v)
      v.is_a?(RX::RxArr)
    end

    def hash?(v)
      v.is_a?(RX::RxHash)
    end

    def integer?(v)
      v.is_a?(Integer) || v.is_a?(RX::RxBig)
    end

    def int_value(v)
      case v
      when Integer then v
      when RX::RxBig then v.value
      end
    end

    def sym_name(v)
      v.name if v.is_a?(RX::RxSym)
    end

    def text(v)
      v.text if v.is_a?(RX::RxStr)
    end

    def bool?(v)
      v == true || v == false
    end

    # Nombres de ivars de un objeto ([] si no es objeto).
    def ivar_names(obj)
      object?(obj) ? obj.attrs.map { |k, _| k.name } : []
    end

    # Par mutable [RxSym, valor] de un ivar, o nil.
    def ivar_pair(obj, name)
      return nil unless object?(obj)

      obj.attrs.find { |k, _| k.name == name }
    end

    def ivar(obj, name)
      ivar_pair(obj, name)&.last
    end

    def ivar?(obj, name)
      !ivar_pair(obj, name).nil?
    end

    # Primer ivar presente entre varios alias: [nombre, par] o nil.
    def first_ivar(obj, names)
      names.each do |n|
        pair = ivar_pair(obj, n)
        return [n, pair] if pair
      end
      nil
    end

    # Valor de una clave de RxHash cuyo nombre (sym/str) coincide.
    def hash_pair(h, key)
      return nil unless hash?(h)

      h.pairs.find { |k, _| key_name(k) == key }
    end

    def hash_get(h, key)
      hash_pair(h, key)&.last
    end

    def key_name(k)
      case k
      when RX::RxSym then k.name
      when RX::RxStr then k.text
      when Integer then k.to_s
      end
    end

    def hash_keys(h)
      hash?(h) ? h.pairs.map { |k, _| key_name(k) } : []
    end

    # ¿Es una "hoja" tal como la cuenta el Collector?
    LEAF_CLASSES = [NilClass, TrueClass, FalseClass, Integer, RX::RxSym, RX::RxStr, RX::RxFloat, RX::RxBig].freeze

    def leaf?(v)
      LEAF_CLASSES.any? { |c| v.is_a?(c) }
    end

    # Resumen corto y serializable de un valor cualquiera (para "extras").
    def summarize(v, max = 120)
      case v
      when nil then { kind: 'nil', display: 'nil' }
      when true, false then { kind: 'bool', display: v.to_s, value: v }
      when Integer then { kind: 'int', display: v.to_s, value: v }
      when RX::RxBig then { kind: 'int', display: v.value.to_s, value: v.value }
      when RX::RxFloat
        f = v.value
        f.respond_to?(:finite?) && f.finite? ? { kind: 'float', display: f.to_s, value: f } : { kind: 'float', display: f.to_s }
      when RX::RxSym then { kind: 'sym', display: ":#{v.name}", value: v.name }
      when RX::RxStr
        t = v.text
        { kind: 'str', display: t.length > max ? "#{t[0, max]}…" : t, value: t.length > max ? t[0, max] : t }
      when RX::RxArr then { kind: 'array', display: "[#{v.items.size}]", count: v.items.size }
      when RX::RxHash then { kind: 'hash', display: "{#{v.pairs.size}}", count: v.pairs.size }
      when RX::Node then { kind: RX.type_desc(v), display: "<#{RX.type_desc(v).sub('obj:', '')}>" }
      else { kind: 'unknown', display: v.inspect[0, max] }
      end
    end
  end

  # Gramatica de rutas identica a la del Collector.
  module Path
    module_function

    def root(index, multi)
      multi ? "$#{index}" : ''
    end

    def attr(name)
      name.start_with?('@') ? name : ".#{name}"
    end

    def key(k)
      case k
      when RX::RxSym then ".#{k.name}"
      when RX::RxStr then "[#{RX.quote(k.text[0, 30])}]"
      when Integer then "{#{k}}"
      when nil, true, false then "{#{k.inspect}}"
      else "{#{RX.type_desc(k)}}"
      end
    end

    def index(i)
      "[#{i}]"
    end
  end

  # Un "lugar" editable dentro del arbol: contenedor + posicion. Equivale a
  # los campos del Collector (`Field`), pero se crea en el momento.
  class Slot
    attr_reader :holder, :kind, :idx, :path, :owner_class

    def initialize(holder, kind, idx, path, owner_class = nil)
      @holder = holder
      @kind = kind
      @idx = idx
      @path = path
      @owner_class = owner_class
    end

    def get
      case @kind
      when :pair then @holder[@idx][1]
      when :item then @holder[@idx]
      end
    end

    def set(v)
      case @kind
      when :pair then @holder[@idx][1] = v
      when :item then @holder[@idx] = v
      end
    end

    # Equivalente `Field` de edit_rxdata.rb (para reusar record_change/apply_*).
    def to_field
      Field.new(@path, @holder, @kind, @idx, [], nil, @owner_class)
    end

    # Slot de un ivar de objeto (o nil si el objeto no lo tiene).
    def self.of_ivar(obj, name, base_path)
      return nil unless Tree.object?(obj)

      i = obj.attrs.index { |k, _| k.name == name }
      return nil unless i

      new(obj.attrs, :pair, i, base_path + Path.attr(name), obj.class_name)
    end

    def self.of_item(arr, i, base_path)
      new(arr.items, :item, i, base_path + Path.index(i))
    end

    def self.of_hash_value(hash, key_name, base_path)
      i = hash.pairs.index { |k, _| Tree.key_name(k) == key_name }
      return nil unless i

      new(hash.pairs, :pair, i, base_path + Path.key(hash.pairs[i][0]))
    end
  end
end
