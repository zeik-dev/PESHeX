# =============================================================================
# map_infos.rb — Nombres de los mapas (Data/MapInfos.rxdata -> Hash { id => RPG::MapInfo }, @name).
# Solo para etiquetar los encuentros salvajes; si no esta o no se entiende, se devuelve un Hash vacio.
# =============================================================================

module Sem
  module GameData
    module MapInfos
      module_function

      # { numero_de_mapa => "Nombre" }
      def read(root)
        path = Locator.resolve(root, 'Data/MapInfos.rxdata')
        return {} unless path

        data = DatReader.read(path)
        return {} unless data.is_a?(Hash)

        data.each_with_object({}) do |(id, info), h|
          next unless id.is_a?(Integer) && info.is_a?(Obj)

          name = info['name']
          h[id] = name.to_s unless name.nil? || name.to_s.empty?
        end
      rescue StandardError
        {}
      end
    end
  end
end
