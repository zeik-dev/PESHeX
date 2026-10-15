# =============================================================================
# cache.rb — Cache en disco de los datos ya leidos de un juego (`Store`): especies, movimientos, objetos, habilidades, tipos,
# MT y limites. Leer los PBS / `.dat` de un fangame grande es lo que mas tarda al vincular la carpeta; con la cache, abrir
# otra partida del mismo juego (o precargarlo desde «Mis juegos») es casi instantaneo.
#
# La cache es un archivo `store-<huella>.bin` en una carpeta que da la app (dentro de sus datos). La HUELLA resume el nombre,
# el tamano y la fecha de los archivos de los que salen los datos (PBS, `Data/*.dat`, Scripts, MapInfos y Game.ini) y la
# version de este formato: si el juego cambia en lo mas minimo, la huella cambia y se vuelve a leer todo. Cualquier fallo al
# leer o escribir la cache se ignora: nunca impide vincular el juego.
#
# Solo guarda datos DEL JUEGO (nada del save), y solo la lee el propio driver desde la carpeta de datos de la app.
# =============================================================================

require 'digest'
require 'fileutils'

module Sem
  module GameData
    module StoreCache
      FORMAT = 1
      MAGIC = 'PESHEX-STORE'.freeze

      module_function

      # Archivos de los que dependen los datos leidos (ruta relativa a la raiz, tal como estan en disco).
      def source_files(root)
        files = []
        ini = Locator.child(root, 'Game.ini')
        files << ini if ini
        pbs = Locator.child(root, 'PBS')
        files.concat(Dir.children(pbs).sort.map { |c| File.join(pbs, c) }.select { |f| File.file?(f) }) if pbs && File.directory?(pbs)
        data = Locator.child(root, 'Data')
        if data && File.directory?(data)
          Dir.children(data).sort.each do |c|
            f = File.join(data, c)
            files << f if File.file?(f) && c.downcase.match?(/\.dat\z|\A(scripts|mapinfos|system)\.rxdata\z/)
          end
        end
        files
      end

      # Huella de un juego: hash de (ruta relativa en minusculas, tamano, fecha) de sus archivos de origen + formato + version
      # de Ruby (la serializacion de Marshal es estable entre 3.x y 4.x, pero asi nunca se mezclan).
      def fingerprint(root)
        base = File.expand_path(root)
        parts = [FORMAT, RUBY_VERSION[/\A\d+\.\d+/]]
        source_files(root).each do |f|
          st = File.stat(f)
          parts << [f.delete_prefix(base).tr('\\', '/').downcase, st.size, st.mtime.to_i]
        end
        Digest::SHA256.hexdigest(parts.inspect)[0, 32]
      end

      def path_for(cache_dir, fingerprint)
        File.join(cache_dir.to_s, "store-#{fingerprint}.bin")
      end

      # ¿Hay una cache valida (misma huella) de este juego?
      def valid?(cache_dir, root)
        cache_dir && File.file?(path_for(cache_dir, fingerprint(root)))
      rescue StandardError
        false
      end

      # Store hidratado desde la cache, o nil si no hay, esta danada o es de otra huella.
      def read(cache_dir, root, source)
        return nil if cache_dir.to_s.empty?

        fp = fingerprint(root)
        path = path_for(cache_dir, fp)
        return nil unless File.file?(path)

        blob = Marshal.load(File.binread(path)) # rubocop:disable Security/MarshalLoad -- archivo propio de la app, ver cabecera
        return nil unless blob.is_a?(Hash) && blob[:magic] == MAGIC && blob[:format] == FORMAT && blob[:fingerprint] == fp

        Store.from_cache_hash(root, source, blob[:data])
      rescue StandardError, ScriptError
        nil
      end

      # Guarda el Store ya cargado; devuelve la huella (o nil si no se pudo). Borra las caches antiguas del mismo juego.
      def write(cache_dir, store)
        return nil if cache_dir.to_s.empty? || !store.loaded?

        fp = fingerprint(store.root)
        FileUtils.mkdir_p(cache_dir)
        path = path_for(cache_dir, fp)
        tmp = "#{path}.tmp-#{Process.pid}"
        File.binwrite(tmp, Marshal.dump({ magic: MAGIC, format: FORMAT, fingerprint: fp, data: store.to_cache_hash }))
        File.rename(tmp, path)
        prune_old(cache_dir, File.basename(path))
        fp
      rescue StandardError
        FileUtils.rm_f(tmp) if tmp
        nil
      end

      # Borra las caches de otras huellas del mismo juego. Se compara por NOMBRE de archivo (no por la ruta completa, que en
      # Windows puede escribirse de varias formas: barras, nombres cortos 8.3, mayusculas) y sin `Dir.glob` (las barras
      # invertidas y los corchetes de una ruta de Windows son caracteres especiales de un patron).
      def prune_old(cache_dir, keep_name)
        Dir.children(cache_dir).each do |name|
          next unless name.start_with?('store-') && name.end_with?('.bin') && name != keep_name

          FileUtils.rm_f(File.join(cache_dir, name))
        end
      rescue StandardError
        nil
      end
    end
  end
end
