require 'test_helper'
require_relative 'fixtures/make_game_folder'

# `reload`: el save cambio en el disco por fuera de PESHeX (p. ej. el jugador guardo desde el juego) y se vuelve a leer sin
# cerrar la sesion. Se conserva la carpeta del juego y el modo; se pierden los cambios sin guardar.
class ReloadTest < Minitest::Test
  def setup
    @h = Harness.new
  end

  # Simula al juego: otro proceso abre el mismo archivo, cambia algo y lo guarda encima.
  def external_save(path, money:)
    other = Harness.new
    other.open(path)
    other.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: money }], mode: 'hax')
    assert other.call('save', backup: false)['applied']
  end

  def test_recarga_lo_que_guardo_otro_programa_y_descarta_los_cambios_sin_guardar
    with_save_copy('Partida_2.rxdata') do |path|
      @h.open(path)
      @h.call('apply_ops', ops: [{ op: 'pokemon.patch', ref: 'party/0', patch: { nickname: 'Mio' } }], mode: 'hax')
      assert @h.session.dirty?
      rev = @h.session.revision

      external_save(path, money: 4_242)
      r = @h.call('reload')

      assert_equal 4_242, @h.call('get_trainer')['trainer']['money']
      refute @h.session.dirty?, 'los cambios sin guardar se descartan'
      assert_operator @h.session.revision, :>, rev, 'la revision sube para que la UI no sirva datos viejos'
      assert r['profile'], 'devuelve el perfil como open'
      assert_equal 'idle', r['indexState']
      refute r['roundtripChecked']
    end
  end

  def test_los_datos_tras_recargar_son_los_mismos_que_los_de_una_apertura_limpia
    with_save_copy('Partida_2.rxdata') do |path|
      @h.open(path)
      external_save(path, money: 777)
      @h.call('reload')

      fresh = Harness.new
      fresh.open(path)
      %w[get_overview get_trainer get_bag].each do |cmd|
        assert_equal fresh.call(cmd), @h.call(cmd), cmd
      end
      assert_equal fresh.session.doc.to_bytes, @h.session.doc.to_bytes
    end
  end

  def test_se_conservan_el_modo_y_la_carpeta_del_juego
    with_save_copy('Partida_2.rxdata') do |path|
      dir = Dir.mktmpdir('peshex_game_reload')
      begin
        GameFixture.build(dir, from: path, names: {})
        @h.open(path)
        @h.call('set_game_folder', path: dir, source: 'manual')
        @h.call('set_mode', mode: 'hex')
        game = @h.session.game
        assert game

        external_save(path, money: 123)
        @h.call('reload')

        assert_same game, @h.session.game, 'no se vuelve a leer la carpeta del juego'
        assert @h.call('get_game_status')['game']['linked']
        assert_equal 'hex', @h.session.mode
        assert @h.session.game_calibration, 'la calibracion se recalcula con el save nuevo'
      ensure
        FileUtils.rm_rf(dir)
      end
    end
  end

  def test_deshacer_ya_no_tiene_nada_que_deshacer_tras_recargar
    with_save_copy('Partida_2.rxdata') do |path|
      @h.open(path)
      @h.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 1 }], mode: 'hax')
      @h.call('reload')
      refute @h.call('undo')['applied'], 'el historial se reinicia'
    end
  end

  def test_un_archivo_a_medio_escribir_no_toca_la_sesion
    with_save_copy('Partida_2.rxdata') do |path|
      @h.open(path)
      @h.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 55 }], mode: 'hax')
      doc = @h.session.doc
      rev = @h.session.revision
      File.binwrite(path, File.binread(path)[0, 100]) # truncado, como si el juego aun escribiera

      err = assert_raises(DriverError) { @h.call('reload') }
      assert_equal 'FormatError', err.error_type
      assert_same doc, @h.session.doc
      assert @h.session.dirty?, 'los cambios sin guardar siguen ahi'
      assert_equal rev, @h.session.revision
      assert_equal 55, @h.call('get_trainer')['trainer']['money']
    end
  end

  def test_un_archivo_que_ya_no_existe_tampoco_la_toca
    with_save_copy('Partida_2.rxdata') do |path|
      @h.open(path)
      doc = @h.session.doc
      File.delete(path)
      err = assert_raises(DriverError) { @h.call('reload') }
      assert_equal 'FileNotFound', err.error_type
      assert_same doc, @h.session.doc
    end
  end

  def test_sin_archivo_abierto_es_un_error
    err = assert_raises(DriverError) { @h.call('reload') }
    assert_equal 'NoSessionOpen', err.error_type
  end

  def test_se_puede_guardar_despues_de_recargar_y_la_copia_es_la_del_juego
    with_save_copy('Partida_2.rxdata') do |path|
      @h.open(path)
      external_save(path, money: 9_001)
      @h.call('reload')
      @h.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 9_002 }], mode: 'hax')
      assert @h.call('save', backup: true)['applied']
      assert_equal 9_002, Harness.new.tap { |x| x.open(path) }.call('get_trainer')['trainer']['money']
      copia = @h.call('list_backups')['backups'].first
      assert copia, 'se hizo copia .bak de lo que habia en disco (el save del juego)'
    end
  end
end
