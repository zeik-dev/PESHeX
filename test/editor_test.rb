require 'test_helper'

# Edicion semantica: operaciones reversibles, validacion blanda, guardado y
# propiedad central "editar + deshacer todo = bytes identicos".
class EditorTest < Minitest::Test
  def setup
    @h = Harness.new
    @h.open(save_path('Partida_2.rxdata'))
    @original = @h.session.doc.to_bytes
  end

  def ops(*list)
    { ops: list }
  end

  def set_trainer(field, value)
    { op: 'set', ref: 'trainer', field: field, value: value }
  end

  def test_editar_dinero_se_ve_y_se_deshace_a_bytes_identicos
    r = @h.call('apply_ops', ops(set_trainer('money', 5000)))
    assert r['applied'], r.inspect
    assert_equal 1, r['pendingCount']
    assert_equal 5000, @h.call('get_trainer')['trainer']['money']
    refute_equal @original, @h.session.doc.to_bytes

    u = @h.call('undo')
    assert u['applied']
    assert_equal 26_350, @h.call('get_trainer')['trainer']['money']
    assert_equal @original, @h.session.doc.to_bytes
    assert_equal 1, @h.call('list_history')['redoCount'] + @h.call('list_history')['undo'].size
  end

  def test_rehacer
    @h.call('apply_ops', ops(set_trainer('money', 777)))
    @h.call('undo')
    r = @h.call('redo')
    assert r['applied']
    assert_equal 777, @h.call('get_trainer')['trainer']['money']
  end

  def test_valor_igual_no_genera_cambio
    r = @h.call('apply_ops', ops(set_trainer('money', 26_350)))
    refute r['applied']
    assert_equal 'no_changes', r['reason']
    refute @h.session.dirty?
  end

  def test_fuera_de_rango_pide_confirmacion_y_se_revierte
    r = @h.call('apply_ops', ops(set_trainer('money', 99_999_999)))
    refute r['applied']
    issue = r.dig('needsConfirmation', 'issues').first
    assert_equal 'value_range', issue['code']
    assert_equal 'money', issue['params']['field']
    assert_equal @original, @h.session.doc.to_bytes, 'no debe quedar nada aplicado'

    r2 = @h.call('apply_ops', ops(set_trainer('money', 99_999_999)).merge(confirmed: true))
    assert r2['applied']
    assert_equal 99_999_999, @h.call('get_trainer')['trainer']['money']
  end

  def test_tipo_invalido_es_un_error_duro
    err = assert_raises(DriverError) { @h.call('apply_ops', ops(set_trainer('money', 'mucho'))) }
    assert_equal 'ValidationError', err.error_type
    assert_equal 'type_mismatch', err.params[:code]
    assert_equal @original, @h.session.doc.to_bytes
  end

  def test_parche_de_pokemon_nivel_iv_ev_apodo_y_objeto
    patch = { level: 50, nickname: 'Rayo', item: 'POTION',
              iv: { HP: 31, SPEED: 31 }, ev: { ATTACK: 252 } }
    r = @h.call('apply_ops', ops(op: 'pokemon.patch', ref: 'party/0', patch: patch))
    assert r['applied'], r.inspect
    pk = @h.call('get_pokemon', ref: 'party/0')['pokemon']
    assert_equal 50, pk['level']
    assert_equal 'Rayo', pk['nickname']
    assert_equal 'POTION', pk['item']['id']
    assert_equal 31, pk['iv']['HP']
    assert_equal 252, pk['ev']['ATTACK']

    @h.call('undo')
    assert_equal @original, @h.session.doc.to_bytes
  end

  def test_iv_fuera_de_rango_requiere_confirmacion
    r = @h.call('apply_ops', ops(op: 'pokemon.patch', ref: 'party/0', patch: { iv: { HP: 40 } }))
    refute r['applied']
    codes = r.dig('needsConfirmation', 'issues').map { |i| i['params']['field'] }
    assert_includes codes, 'iv.HP'
  end

  def test_ev_total_excesivo_es_solo_advertencia
    patch = { ev: { HP: 252, ATTACK: 252, DEFENSE: 252 } }
    r = @h.call('apply_ops', ops(op: 'pokemon.patch', ref: 'party/0', patch: patch))
    assert r['applied'], r.inspect
    assert(r['issues'].any? { |i| i['code'] == 'ev_total_over' })
  end

  def test_movimientos_reemplazar_agregar_y_quitar
    before = @h.call('get_pokemon', ref: 'party/0')['pokemon']['moves'].size
    r = @h.call('apply_ops', ops(op: 'pokemon.patch', ref: 'party/0',
                                 patch: { moves: [{ slot: 0, id: 'TACKLE', pp: 35 }] }))
    assert r['applied'], r.inspect
    m = @h.call('get_pokemon', ref: 'party/0')['pokemon']['moves'].first
    assert_equal 'TACKLE', m['id']
    assert_equal 35, m['pp']

    r2 = @h.call('apply_ops', ops(op: 'pokemon.patch', ref: 'party/0', patch: { moves: [{ slot: 3, remove: true }] }))
    assert r2['applied']
    assert_equal before - 1, @h.call('get_pokemon', ref: 'party/0')['pokemon']['moves'].size

    r3 = @h.call('apply_ops', ops(op: 'pokemon.patch', ref: 'party/0',
                                  patch: { moves: [{ slot: before - 1, id: 'SURF', pp: 15, ppUps: 0 }] }))
    assert r3['applied'], r3.inspect
    assert_equal 'SURF', @h.call('get_pokemon', ref: 'party/0')['pokemon']['moves'].last['id']

    3.times { @h.call('undo') }
    assert_equal @original, @h.session.doc.to_bytes
  end

  def test_bolsa_cambiar_cantidad_agregar_y_quitar
    bag = -> { @h.call('get_bag')['bag'] }
    potion = bag.call['pockets'][1]['slots'].find { |s| s['id'] == 'POTION' }
    r = @h.call('apply_ops', ops(op: 'bag.set', ref: potion['ref'], qty: 99))
    assert r['applied'], r.inspect
    assert_equal 99, bag.call['pockets'][1]['slots'].find { |s| s['id'] == 'POTION' }['qty']

    n = bag.call['pockets'][0]['count']
    r2 = @h.call('apply_ops', ops(op: 'bag.set', pocket: 1, id: 'MASTERBALL', qty: 5))
    assert r2['applied'], r2.inspect
    assert_equal n + 1, bag.call['pockets'][0]['count']
    assert_equal 'MASTERBALL', bag.call['pockets'][0]['slots'].last['id']

    r3 = @h.call('apply_ops', ops(op: 'bag.set', ref: potion['ref'], qty: 0))
    assert r3['applied']
    refute(bag.call['pockets'][1]['slots'].any? { |s| s['id'] == 'POTION' })

    3.times { @h.call('undo') }
    assert_equal @original, @h.session.doc.to_bytes
  end

  def test_cantidad_sobre_el_maximo_por_ranura_pide_confirmacion
    r = @h.call('apply_ops', ops(op: 'bag.set', pocket: 1, id: 'MASTERBALL', qty: 5000))
    refute r['applied']
    assert_equal 'qty_range', r.dig('needsConfirmation', 'issues').first['code']
  end

  def test_medallas
    r = @h.call('apply_ops', ops(op: 'trainer.badge', index: 3, value: true))
    assert r['applied']
    assert_equal 2, @h.call('get_trainer')['trainer']['badges'].count(true)
  end

  def test_extra_set_edita_un_ivar_sin_control_propio
    r = @h.call('apply_ops', ops(op: 'extra.set', ref: 'party/0', ivar: '@cool', value: 7))
    assert r['applied'], r.inspect
    cool = @h.call('get_pokemon', ref: 'party/0')['pokemon']['extras'].find { |e| e['name'] == '@cool' }
    assert_equal 7, cool['value']
  end

  def test_pokemon_compartido_se_edita_en_ambos_lugares
    @h.call('apply_ops', ops(op: 'pokemon.patch', ref: 'party/1', patch: { nickname: 'Doble' }))
    ex = @h.call('list_changes')
    assert_equal 1, ex['count']
    shared = @h.call('get_pokemon', ref: 'party/1')['pokemon']['shared']
    assert_includes shared, '.variables@data[803]'
  end

  def test_preview_no_modifica_nada
    r = @h.call('preview_ops', ops(set_trainer('money', 1)))
    assert_equal 1, r['changes'].size
    assert_equal @original, @h.session.doc.to_bytes
    refute @h.session.dirty?
  end

  def test_secuencias_aleatorias_y_deshacer_todo_devuelven_bytes_identicos
    rng = Random.new(42)
    candidatos = [
      -> { ops(set_trainer('money', rng.rand(0..999_999))) },
      -> { ops(op: 'pokemon.patch', ref: "party/#{rng.rand(0..5)}", patch: { level: rng.rand(1..100) }) },
      -> { ops(op: 'pokemon.patch', ref: "party/#{rng.rand(0..5)}", patch: { iv: { HP: rng.rand(0..31) } }) },
      -> { ops(op: 'pokemon.patch', ref: "party/#{rng.rand(0..5)}", patch: { nickname: "N#{rng.rand(100)}" }) },
      -> { ops(op: 'bag.set', pocket: rng.rand(1..8), id: "ITEM#{rng.rand(5)}", qty: rng.rand(0..50)) },
      -> { ops(op: 'trainer.badge', index: rng.rand(0..7), value: rng.rand(2).zero?) }
    ]
    30.times { @h.call('apply_ops', candidatos.sample(random: rng).call.merge(confirmed: true)) }
    assert @h.session.dirty?
    @h.call('undo_all')
    refute @h.session.dirty?
    assert_equal @original, @h.session.doc.to_bytes
  end

  def test_guardar_y_reabrir_conserva_los_cambios_y_el_roundtrip
    with_save_copy('Partida_2.rxdata') do |path|
      h = Harness.new
      h.open(path)
      h.call('apply_ops', ops(set_trainer('money', 12_345)))
      h.call('apply_ops', ops(op: 'pokemon.patch', ref: 'party/0', patch: { level: 44, iv: { SPEED: 5 } }))
      h.call('apply_ops', ops(op: 'bag.set', pocket: 3, id: 'ULTRABALL', qty: 12))
      saved = h.call('save')
      assert saved['applied'], saved.inspect
      assert_equal 3, saved['changesApplied']
      assert saved['backupPath'] && File.exist?(saved['backupPath'])
      refute h.session.dirty?

      h2 = Harness.new
      h2.open(path)
      assert_equal true, h2.call('verify_roundtrip')['roundtripClean']
      assert_equal 12_345, h2.call('get_trainer')['trainer']['money']
      pk = h2.call('get_pokemon', ref: 'party/0')['pokemon']
      assert_equal 44, pk['level']
      assert_equal 5, pk['iv']['SPEED']
      ball = h2.call('get_bag')['bag']['pockets'][2]['slots'].find { |s| s['id'] == 'ULTRABALL' }
      assert_equal 12, ball['qty']
    end
  end

  def test_guardar_con_errores_pendientes_pide_confirmacion
    with_save_copy('Partida_2.rxdata') do |path|
      h = Harness.new
      h.open(path)
      h.call('apply_ops', ops(set_trainer('money', 99_999_999)).merge(confirmed: true))
      r = h.call('save')
      refute r['applied']
      assert_equal 'validation', r['reason']
      r2 = h.call('save', confirmed: true)
      assert r2['applied']
    end
  end

  def test_la_edicion_cruda_tambien_es_reversible
    r = @h.call('locate_field', path: '.player@money')
    @h.call('set_field', index: r['index'], input: 'int:42')
    assert_equal 42, @h.call('get_trainer')['trainer']['money']
    assert_equal 1, @h.call('list_changes')['count']
    @h.call('undo')
    assert_equal @original, @h.session.doc.to_bytes
  end
end
