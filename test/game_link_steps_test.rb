require 'test_helper'
require_relative 'fixtures/make_game_folder'
require_relative 'fixtures/real_games'

# Carga de la carpeta del juego por pasos (begin -> step* -> finish): permite a la UI mostrar el progreso real.
class GameLinkStepsTest < Minitest::Test
  include RealGames

  def self.fixture_dir
    @fixture_dir ||= Dir.mktmpdir('peshex_link').tap do |d|
      GameFixture.build(d, from: File.join(SAVES_DIR, 'Partida_2.rxdata'))
    end
  end

  def setup
    @h = Harness.new
    @h.open(save_path('Partida_2.rxdata'))
  end

  def linked?
    @h.call('get_game_status')['game']['linked']
  end

  def test_begin_lista_los_pasos_y_no_vincula_hasta_terminar
    out = @h.call('game_link_begin', path: self.class.fixture_dir)
    assert_equal %w[species moves items abilities types extras settings calibration], out['steps']
    refute linked?, 'mientras carga no esta vinculada'
    out['steps'].each { |id| assert_equal id, @h.call('game_link_step', id: id)['step'] }
    refute linked?, 'faltaba el finish'
    st = @h.call('game_link_finish')['game']
    assert st['linked']
    assert_equal 'ready', st['data']['state']
    assert st['calibration'], 'la calibracion se calcula en su paso'
  end

  def test_el_resultado_es_el_mismo_que_con_set_game_folder
    @h.call('game_link_begin', path: self.class.fixture_dir)
    %w[species moves items abilities types extras settings calibration].each { |id| @h.call('game_link_step', id: id) }
    stepped = @h.call('game_link_finish')['game']
    direct = @h.call('set_game_folder', path: self.class.fixture_dir)['game']
    assert_equal direct['data']['domains'], stepped['data']['domains']
    assert_equal direct['limits'], stepped['limits']
    assert_equal direct['calibration'], stepped['calibration']
  end

  def test_errores_claros_sin_begin_con_pasos_incompletos_y_pasos_desconocidos
    err = assert_raises(DriverError) { @h.call('game_link_step', id: 'species') }
    assert_equal 'NoPendingGameLink', err.error_type
    @h.call('game_link_begin', path: self.class.fixture_dir)
    err = assert_raises(DriverError) { @h.call('game_link_finish') }
    assert_equal 'GameLinkIncomplete', err.error_type
    err = assert_raises(DriverError) { @h.call('game_link_step', id: 'nope') }
    assert_equal 'unknown_step', err.params[:code]
  end

  def test_begin_con_ruta_vacia_desvincula
    @h.call('set_game_folder', path: self.class.fixture_dir)
    assert linked?
    out = @h.call('game_link_begin', path: '')
    assert_equal [], out['steps']
    refute linked?
  end

  def test_un_begin_nuevo_descarta_la_carga_anterior
    @h.call('game_link_begin', path: self.class.fixture_dir)
    @h.call('game_link_step', id: 'species')
    @h.call('game_link_begin', path: self.class.fixture_dir)
    err = assert_raises(DriverError) { @h.call('game_link_finish') }
    assert_equal 'GameLinkIncomplete', err.error_type, 'empieza de cero'
  end

  def test_con_el_juego_real_z_por_pasos
    root = real_game_root(:z)
    z = Harness.new
    z.open(real_save(:z))
    out = z.call('game_link_begin', path: root)
    out['steps'].each { |id| z.call('game_link_step', id: id) }
    st = z.call('game_link_finish')['game']
    assert_equal 1018, st['data']['domains']['species']['count']
    assert_equal 36, st['limits']['boxCount'], 'STORAGEBOXES de los scripts de Z'
  end
end
