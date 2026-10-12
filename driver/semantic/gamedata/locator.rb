# =============================================================================
# locator.rb — Localiza y describe la carpeta de un juego de Essentials.
#
# Las busquedas de archivos ignoran mayusculas/minusculas (en Windows da igual,
# pero asi tambien funciona en Linux con juegos copiados de Windows).
# =============================================================================

module Sem
  module GameData
    module Locator
      module_function

      # Hijo de `dir` cuyo nombre coincide sin distinguir mayusculas, o nil.
      def child(dir, name)
        return nil unless dir && File.directory?(dir)

        exact = File.join(dir, name)
        return exact if File.exist?(exact)

        found = Dir.children(dir).find { |c| c.casecmp?(name) }
        found && File.join(dir, found)
      end

      # Resuelve "Data/species.dat" segmento a segmento.
      def resolve(root, rel)
        rel.to_s.split('/').reject(&:empty?).reduce(root) do |dir, seg|
          return nil unless dir

          child(dir, seg)
        end
      end

      def game_root?(dir)
        return false unless dir && File.directory?(dir)

        !child(dir, 'Game.ini').nil? ||
          !resolve(dir, 'Data/Scripts.rxdata').nil? ||
          (!child(dir, 'Data').nil? && !child(dir, 'Graphics').nil?)
      end

      # Sube hasta 4 niveles desde la carpeta del save buscando la raiz del juego.
      # (En v19+ el save vive en %APPDATA%, asi que esto solo acierta con juegos
      # portables o antiguos; la UI recuerda la carpeta elegida por juego.)
      def find_from_save(save_path)
        d = File.dirname(File.expand_path(save_path.to_s))
        5.times do
          return d if game_root?(d)

          parent = File.dirname(d)
          break if parent == d

          d = parent
        end
        nil
      end

      def title(root)
        ini = child(root, 'Game.ini')
        return nil unless ini

        File.binread(ini).force_encoding('UTF-8').scrub.each_line do |l|
          return Regexp.last_match(1).strip if l =~ /\ATitle\s*=\s*(.+?)\s*\z/i
        end
        nil
      rescue SystemCallError
        nil
      end

      # Datos sobre la carpeta: que hay y que no (la UI lo muestra tal cual).
      def describe(root)
        data = child(root, 'Data')
        graphics = child(root, 'Graphics')
        {
          root: root, title: title(root),
          hasData: !data.nil?, hasGraphics: !graphics.nil?,
          hasPbs: !child(root, 'PBS').nil?,
          # Juegos empaquetados (Game.rgssad/rgss3a) no se pueden leer.
          encrypted: Dir.children(root).any? { |c| c =~ /\.rgss(ad|2a|3a)\z/i }
        }
      end
    end
  end
end
