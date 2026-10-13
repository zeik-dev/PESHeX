# =============================================================================
# settings_scan.rb — Lee de los scripts del juego las constantes que fijan los
# limites (Settings::MAXIMUM_LEVEL, MAX_PARTY_SIZE, MAX_MONEY...). Las bases
# personalizadas los cambian a menudo; asi la validacion y la legalidad usan los
# valores REALES del juego en lugar de los de Essentials vanilla.
#
# Solo se aceptan literales enteros (`MAX_MONEY = 999_999`); si el script usa una
# expresion, ese limite queda con su valor por defecto.
# =============================================================================

require 'zlib'

module Sem
  module GameData
    module SettingsScan
      # nombre en el script => clave del limite (las mismas que usa Sem::VANILLA_LIMITS)
      CONSTANTS = {
        'MAXIMUM_LEVEL' => :maxLevel, 'MAX_PARTY_SIZE' => :partySize, 'NUM_STORAGE_BOXES' => :boxCount,
        'MAX_MONEY' => :maxMoney, 'MAX_COINS' => :maxCoins, 'MAX_BATTLE_POINTS' => :maxBattlePoints,
        'MAX_SOOT' => :maxSoot, 'MAX_PLAYER_NAME_SIZE' => :maxPlayerName, 'BAG_MAX_PER_SLOT' => :bagPerSlot,
        'IV_STAT_LIMIT' => :ivMax, 'EV_STAT_LIMIT' => :evStatMax, 'EV_LIMIT' => :evTotalMax,
        'MAX_NAME_SIZE' => :maxNickname, 'MAX_MOVES' => :maxMoves,
        # nombres de Essentials v16-18 (sin guiones bajos)
        'MAXIMUMLEVEL' => :maxLevel, 'MAXPARTYSIZE' => :partySize, 'STORAGEBOXES' => :boxCount,
        'MAXMONEY' => :maxMoney, 'MAXCOINS' => :maxCoins
      }.freeze
      DEFAULTS = {
        maxLevel: 100, partySize: 6, boxCount: 40, maxMoney: 999_999, maxCoins: 99_999, maxBattlePoints: 9_999,
        maxSoot: 9_999, maxPlayerName: 10, bagPerSlot: 999, ivMax: 31, evStatMax: 252, evTotalMax: 510,
        maxNickname: 10, maxMoves: 4
      }.freeze
      # `$BallTypes = { 0=>:POKEBALL, 1=>:GREATBALL, ... }` (v16-18): indice del Pokémon -> objeto-bola.
      BALL_TABLE = /\$BallTypes\s*=\s*\{(.*?)\}/m
      LINE = /\A\s*(?:[A-Za-z_:]+::)?(#{CONSTANTS.keys.join('|')})\s*=\s*(-?\d[\d_]*)\s*(?:#.*)?\z/

      module_function

      # Devuelve { values: { clave => n } (solo lo encontrado), found: { clave => 'archivo' }, files: n,
      #            balls: { indice => 'POKEBALL' } (v16-18, si el juego define $BallTypes) }
      def scan(root)
        found = {}
        balls = {}
        files = 0
        each_source(root) do |label, code|
          files += 1
          if balls.empty? && code.include?('$BallTypes') && (bm = BALL_TABLE.match(code))
            bm[1].scan(/(\d+)\s*=>\s*:(\w+)/) { |i, name| balls[i.to_i] = name }
          end
          code.each_line do |line|
            next unless (m = LINE.match(line))

            key = CONSTANTS[m[1]]
            found[key] ||= { value: m[2].delete('_').to_i, source: label }
          end
        end
        { values: found.transform_values { |v| v[:value] }, found: found.transform_values { |v| v[:source] }, files: files,
          balls: balls }
      rescue StandardError => e
        { values: {}, found: {}, files: 0, balls: {}, error: "#{e.class}: #{e.message}" }
      end

      # Cede [etiqueta, codigo] de cada script del juego (rxdata zlib o .rb).
      def each_source(root)
        ScriptIndex.game_script_paths(root).each do |path|
          if File.directory?(path)
            Dir.glob('**/*.rb', base: path).sort.each do |f|
              yield f, File.binread(File.join(path, f)).force_encoding('UTF-8').scrub
            end
          elsif path =~ /\.rxdata\z/i
            each_rxdata_source(path) { |label, code| yield label, code }
          end
        end
      end

      def each_rxdata_source(path)
        doc = RxDocument.parse(File.binread(path))
        stack = doc.roots.dup
        until stack.empty?
          v = stack.pop
          next unless v.is_a?(RxMarshal::RxArr)

          label = nil
          v.items.each do |it|
            next unless it.is_a?(RxMarshal::RxStr)

            if it.bytes.getbyte(0) == 0x78 && (code = Zlib::Inflate.inflate(it.bytes) rescue nil)
              yield "#{File.basename(path)}[#{label || '?'}]", code.force_encoding('UTF-8').scrub
            elsif label.nil? && it.bytes.bytesize < 300
              label = it.text.split(%r{[\\/]}).last
            end
          end
          v.items.each { |it| stack << it if it.is_a?(RxMarshal::RxArr) }
        end
      end
    end
  end
end
