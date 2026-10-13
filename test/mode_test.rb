require 'test_helper'

# Modo HeX / HaX: seleccion, persistencia en la sesion y efecto en la edicion.
class ModeTest < Minitest::Test
  def setup
    @h = Harness.new
  end

  def test_el_modo_por_defecto_es_hax
    r = @h.open(save_path('Partida_2.rxdata'))
    assert_equal 'hax', r['mode']
    assert_equal 'hax', @h.call('get_mode')['mode']
  end

  def test_open_acepta_el_modo_y_set_mode_lo_cambia
    r = @h.open(save_path('Partida_2.rxdata'), mode: 'hex')
    assert_equal 'hex', r['mode']
    assert_equal 'hax', @h.call('set_mode', mode: 'hax')['mode']
    assert_equal 'hax', @h.call('get_mode')['mode']
  end

  def test_un_modo_invalido_en_open_se_ignora_y_en_set_mode_es_error
    r = @h.open(save_path('Partida_2.rxdata'), mode: 'dios')
    assert_equal 'hax', r['mode']
    err = assert_raises(DriverError) { @h.call('set_mode', mode: 'dios') }
    assert_equal 'ValidationError', err.error_type
    assert_equal 'unknown_mode', err.params[:code]
  end

  def test_cambiar_de_modo_sube_la_revision_y_no_ensucia_el_documento
    @h.open(save_path('Partida_2.rxdata'))
    rev = @h.session.revision
    @h.call('set_mode', mode: 'hax')
    assert_operator @h.session.revision, :>, rev
    refute @h.session.dirty?
  end

  def test_el_modo_de_la_sesion_decide_cuando_apply_ops_no_lo_indica
    @h.open(save_path('Partida_2.rxdata'))
    ops = { ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 99_999_999 }] }
    assert @h.call('apply_ops', ops)['applied'] # por defecto, HaX
    @h.call('undo')
    @h.call('set_mode', mode: 'hex')
    refute @h.call('apply_ops', ops)['applied']
    # el parametro de la peticion gana sobre el modo de la sesion
    assert @h.call('apply_ops', ops.merge(mode: 'hax'))['applied']
  end

  def test_cada_sesion_tiene_su_modo
    @h.open(save_path('Partida_2.rxdata'), mode: 'hex')
    h2 = Harness.new
    h2.open(save_path('Partida_2.rxdata'))
    assert_equal 'hex', @h.call('get_mode')['mode']
    assert_equal 'hax', h2.call('get_mode')['mode']
  end
end
