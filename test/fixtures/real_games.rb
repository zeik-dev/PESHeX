# Carpetas de juego REALES de prueba (test_pbs/): Pokémon Z (Essentials v16-18: PBS CSV, ids enteros,
# Data/Scripts.rxdata) y Pokémon Añil (v21: PBS sectioned). Se ensamblan en un directorio temporal copiando
# solo lo que el driver lee (PBS, Scripts, System y MapInfos), nunca modifican test_pbs/ y los tests que las
# usan se omiten (`skip`) si test_pbs/ no esta (p. ej. un checkout parcial).
#
#   include RealGames
#   def test_algo
#     root = real_game_root(:z)   # o skip automatico si no existe
#   end

require 'tmpdir'
require 'fileutils'

module RealGames
  TEST_PBS = File.join(ROOT, 'test_pbs')

  GAMES = {
    z: { pbs: 'PBS_POKEMON_Z', data: 'Data_POKEMON_Z', save: 'Game.rxdata' },
    anil: { pbs: 'PBS_POKEMON_ANIL', data: nil, save: 'Partida.rxdata' }
  }.freeze

  # Archivos de Data/ que lee el driver (los .dat v16-18 y las animaciones pesan decenas de MB y no se usan).
  DATA_FILES = %w[Scripts.rxdata System.rxdata MapInfos.rxdata].freeze

  @roots = {}
  @stores = {}

  class << self
    attr_reader :roots, :stores

    def available?(key)
      cfg = GAMES.fetch(key)
      File.directory?(File.join(TEST_PBS, cfg[:pbs]))
    end

    def build(key)
      @roots[key] ||= begin
        cfg = GAMES.fetch(key)
        dir = Dir.mktmpdir("peshex_real_#{key}")
        at_exit { FileUtils.rm_rf(dir) }
        FileUtils.mkdir_p(File.join(dir, 'Data'))
        FileUtils.cp_r(File.join(TEST_PBS, cfg[:pbs]), File.join(dir, 'PBS'))
        if cfg[:data]
          DATA_FILES.each do |f|
            src = File.join(TEST_PBS, cfg[:data], f)
            FileUtils.cp(src, File.join(dir, 'Data', f)) if File.exist?(src)
          end
        end
        File.write(File.join(dir, 'Game.ini'), "[Game]\nTitle=#{key}\n")
        dir
      end
    end
  end

  def real_game_root(key)
    skip "test_pbs/ no tiene #{RealGames::GAMES.fetch(key)[:pbs]}" unless RealGames.available?(key)
    RealGames.build(key)
  end

  # Store del juego real ya cargado (memoizado por proceso: parsear Añil tarda ~0,5 s).
  def real_store(key)
    RealGames.stores[key] ||= Sem::GameData::Store.load(real_game_root(key))
  end

  def real_save(key)
    path = File.join(SAVES_DIR, RealGames::GAMES.fetch(key)[:save])
    skip "falta #{path}" unless File.exist?(path)
    path
  end
end
