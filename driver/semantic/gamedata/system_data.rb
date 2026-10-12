# =============================================================================
# system_data.rb — Nombres de switches y variables del juego (Data/System.rxdata
# -> RPG::System @switches / @variables). Indices desde 1 (el 0 no se usa).
# =============================================================================

module Sem
  module GameData
    module SystemData
      module_function

      # { switches: [nil, "Nombre", ...], variables: [...] } o nil
      def read(root)
        path = Locator.resolve(root, 'Data/System.rxdata')
        return nil unless path

        doc = RxDocument.parse(File.binread(path))
        obj = doc.roots.first
        return nil unless Tree.object?(obj)

        { switches: names(Tree.ivar(obj, '@switches')), variables: names(Tree.ivar(obj, '@variables')),
          gameTitle: Tree.text(Tree.ivar(obj, '@game_title')) }
      rescue StandardError
        nil
      end

      def names(arr)
        return [] unless Tree.array?(arr)

        arr.items.map { |x| Tree.text(x) }
      end
    end
  end
end
