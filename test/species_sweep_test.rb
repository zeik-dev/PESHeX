require 'test_helper'
require 'tmpdir'
require 'fileutils'
require_relative 'fixtures/real_games'
require_relative 'fixtures/make_game_folder'

# Barrido de la ficha de la Pokédex: `get_species` y `get_species_extras` de CADA especie y forma, por el comando del
# driver (con la ida y vuelta a JSON del protocolo). Detecta un dato raro que haga fallar una sola ficha (la UI se queda
# en «Cargando…») en cualquier version de Ruby del CI (3.3 y 4.0). Las variantes con juegos reales se omiten sin test_pbs/.
class SpeciesSweepTest < Minitest::Test
  include RealGames

  def setup
    @h = Harness.new
  end

  # Abre `save`, vincula `root` y recorre todas las especies. Devuelve cuantas entradas se recorrieron.
  def sweep(save, root)
    @h.open(save)
    state = @h.call('set_game_folder', path: root, source: 'manual').dig('game', 'data', 'state')
    assert_includes %w[ready partial], state
    entries = @h.session.game.table(:species).values.map { |e| [e.species, e.form] }
    refute_empty entries
    failures = []
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    entries.each do |species, form|
      detail = @h.call('get_species', species: species, form: form)['species']
      failures << "get_species #{species}/#{form}: sin datos" unless detail && detail['id']
      extras = @h.call('get_species_extras', species: species, form: form)
      failures << "get_species_extras #{species}/#{form}: sin zonas" unless extras['encounters'].is_a?(Array) && extras['regional'].is_a?(Hash)
    rescue StandardError => e
      failures << "#{species}/#{form}: #{e.class}: #{e.message[0, 120]}"
    end
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0
    assert_empty failures.first(8), "#{failures.size} fichas fallan de #{entries.size}"
    assert_operator elapsed, :<, 60, "el barrido tardo #{elapsed.round(1)} s: una ficha lenta bloquea el driver"
    entries.size
  end

  def test_z_real
    n = sweep(real_save(:z), real_game_root(:z))
    assert_equal 1018, n
  end

  def test_anil_real
    n = sweep(File.join(SAVES_DIR, 'Partida_2.rxdata'), real_game_root(:anil))
    assert_equal 1519, n
  end

  # La carpeta REAL de Z trae Data/ entera (con los .dat de v16-18, que no son Marshal): deben caer al PBS sin romper nada.
  def test_z_con_la_carpeta_data_completa
    skip 'falta test_pbs/Data_POKEMON_Z' unless RealGames.available?(:z)
    Dir.mktmpdir('peshex_zfull') do |dir|
      begin
        File.symlink(File.join(RealGames::TEST_PBS, 'Data_POKEMON_Z'), File.join(dir, 'Data'))
        File.symlink(File.join(RealGames::TEST_PBS, 'PBS_POKEMON_Z'), File.join(dir, 'PBS'))
      rescue NotImplementedError, SystemCallError
        skip 'este sistema no permite enlaces simbolicos'
      end
      File.write(File.join(dir, 'Game.ini'), "[Game]\nTitle=Z\n")
      assert_equal 1018, sweep(real_save(:z), dir)
    end
  end

  # Los PBS editados en Windows llevan CRLF: ningun id ni texto debe arrastrar el "\r".
  def test_pbs_con_saltos_de_linea_crlf
    skip 'falta test_pbs/PBS_POKEMON_Z' unless RealGames.available?(:z)
    Dir.mktmpdir('peshex_crlf') do |dir|
      FileUtils.mkdir_p(File.join(dir, 'Data'))
      FileUtils.cp_r(File.join(RealGames::TEST_PBS, 'PBS_POKEMON_Z'), File.join(dir, 'PBS'))
      Dir.glob(File.join(dir, 'PBS', '*.txt')).each do |f|
        File.binwrite(f, File.binread(f).gsub("\r\n", "\n").gsub("\n", "\r\n"))
      end
      File.write(File.join(dir, 'Game.ini'), "[Game]\nTitle=Z\n")
      assert_equal 1018, sweep(real_save(:z), dir)
      refute(@h.session.game.table(:species).values.any? { |e| e.id.to_s.match?(/\s/) }, 'un id con espacio o CR')
    end
  end

  # Camino de los .dat compilados (v19+) con la carpeta sintetica del fixture.
  def test_dat_sintetico
    Dir.mktmpdir('peshex_dat') do |dir|
      save = File.join(SAVES_DIR, 'Partida_2.rxdata')
      GameFixture.build(dir, from: save)
      assert_operator sweep(save, dir), :>, 50
    end
  end

  # Un dato raro en una parte opcional no debe dejar la ficha sin datos: se entrega lo demas y el fallo viaja en `warnings`.
  def test_la_ficha_degrada_por_partes
    Dir.mktmpdir('peshex_degrade') do |dir|
      save = File.join(SAVES_DIR, 'Partida_2.rxdata')
      GameFixture.build(dir, from: save)
      @h.open(save)
      @h.call('set_game_folder', path: dir, source: 'manual')
      game = @h.session.game
      species = game.table(:species).values.find { |e| e.form.zero? }.species

      ok = @h.call('get_species', species: species)['species']
      refute ok.key?('warnings'), 'sin fallos no hay avisos'

      game.define_singleton_method(:learn_profile) { |*_| raise 'perfil roto' }
      game.define_singleton_method(:prevos) { |*_| raise 'evoluciones rotas' }
      detail = @h.call('get_species', species: species)['species']
      assert_equal species, detail['species']
      assert_kind_of Hash, detail['baseStats']
      assert_equal [], detail['learnable']
      assert_equal [], detail['prevos']
      assert_equal 1, detail['minimumLevel'], 'minimum_level tambien usa prevos'
      assert_equal %w[learnable prevos minimumLevel], detail['warnings'].map { |w| w.split(':').first }
      assert_match(/learnable: RuntimeError: perfil roto/, detail['warnings'].first)

      game.define_singleton_method(:encounters_for) { |*_| raise 'zonas rotas' }
      extras = @h.call('get_species_extras', species: species)
      assert_equal [], extras['encounters']
      assert_kind_of Hash, extras['regional']
      assert_match(/encounters: RuntimeError: zonas rotas/, extras['warnings'].first)
    end
  end
end
