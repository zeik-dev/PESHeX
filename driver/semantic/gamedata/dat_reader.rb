# =============================================================================
# dat_reader.rb — Lee los `Data/*.dat` (Marshal de GameData::*) SIN ejecutar
# Marshal.load: se parsea con RxDocument (no instancia clases ni corre codigo del
# juego) y se convierte el arbol de nodos a datos Ruby simples.
#
# Objetos -> Obj(cls, iv) con iv = { 'species' => ..., ... } (ivars sin '@').
# Simbolos -> Symbol; strings -> String UTF-8; hashes -> Hash.
# =============================================================================

module Sem
  module GameData
    Obj = Struct.new(:cls, :iv) do
      def [](name)
        iv[name.to_s]
      end

      def key?(name)
        iv.key?(name.to_s)
      end
    end

    module DatReader
      MAX_DEPTH = 40

      module_function

      def read(path)
        doc = RxDocument.parse(File.binread(path))
        plain(doc.roots.first, 0)
      end

      # Convierte un nodo a datos simples. Lo que no se entiende queda en nil.
      def plain(node, depth)
        return nil if depth > MAX_DEPTH

        case node
        when nil, true, false, Integer then node
        when RxMarshal::RxBig, RxMarshal::RxFloat then node.value
        when RxMarshal::RxSym then node.name.to_sym
        when RxMarshal::RxStr then node.text
        when RxMarshal::RxArr then node.items.map { |x| plain(x, depth + 1) }
        when RxMarshal::RxHash
          node.pairs.each_with_object({}) do |(k, v), h|
            key = plain(k, depth + 1)
            h[key.is_a?(Obj) ? key.cls : key] = plain(v, depth + 1)
          end
        when RxMarshal::RxObj, RxMarshal::RxStruct
          iv = node.attrs.to_h { |k, v| [k.name.sub(/\A@/, ''), plain(v, depth + 1)] }
          Obj.new(node.class_name, iv)
        when RxMarshal::RxUMarshal, RxMarshal::RxData
          plain(node.data, depth + 1)
        end
      end
    end
  end
end
