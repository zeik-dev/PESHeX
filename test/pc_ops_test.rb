require 'test_helper'

# Mover, intercambiar y liberar Pokemon entre cajas y equipo (UI estilo PC).
class PcOpsTest < Minitest::Test
  def setup
    @h = Harness.new
    @h.open(save_path('Partida_2.rxdata'))
    @original = @h.session.doc.to_bytes
  end

  def move(from, to)
    @h.call('apply_ops', ops: [{ op: 'pokemon.move', from: from, to: to }])
  end

  def boxes
    @h.call('list_boxes')['storage']['boxes']
  end

  def filled
    boxes.flat_map { |b| b['slots'].each_with_index.filter_map { |s, i| s && "box/#{b['index']}/#{i}" } }
  end

  def empty_slot(skip = [])
    boxes.each do |b|
      b['slots'].each_with_index { |s, i| return "box/#{b['index']}/#{i}" if s.nil? && !skip.include?("box/#{b['index']}/#{i}") }
    end
    flunk 'no hay casillas vacias'
  end

  def species_at(ref)
    @h.call('get_pokemon', ref: ref).dig('pokemon', 'species', 'id')
  rescue DriverError
    nil
  end

  def party
    @h.call('list_party')['party'].map { |p| p['species']['id'] }
  end

  def assert_original
    assert_equal @original, @h.session.doc.to_bytes
    refute @h.session.dirty?
  end

  def test_caja_a_caja_en_casilla_vacia_y_deshacer
    src = filled.first
    dst = empty_slot
    sp = species_at(src)
    r = move(src, dst)
    assert r['applied'], r.inspect
    assert_equal sp, species_at(dst)
    assert_nil species_at(src)
    @h.call('undo')
    assert_original
  end

  def test_caja_a_caja_intercambia_si_el_destino_esta_ocupado
    a, b = filled.first(2)
    sa = species_at(a)
    sb = species_at(b)
    assert move(a, b)['applied']
    assert_equal sb, species_at(a)
    assert_equal sa, species_at(b)
    @h.call('undo')
    assert_original
  end

  def test_equipo_a_caja_vacia_saca_al_pokemon_del_equipo
    before = party
    dst = empty_slot
    assert move('party/5', dst)['applied']
    assert_equal before.first(5), party
    assert_equal before.last, species_at(dst)
    @h.call('undo')
    assert_original
  end

  def test_caja_a_final_del_equipo_cuando_hay_hueco
    before = party
    dst = empty_slot
    move('party/5', dst) # equipo de 5
    sp = species_at(dst)
    assert move(dst, 'party/5')['applied']
    assert_equal before, party
    assert_equal sp, party.last
    assert_nil species_at(dst)
    2.times { @h.call('undo') }
    assert_original
  end

  def test_equipo_lleno_rechaza_y_no_deja_nada_aplicado
    err = assert_raises(DriverError) { move(filled.first, 'party/6') }
    assert_equal 'PartyFull', err.error_type
    assert_original
  end

  def test_equipo_con_caja_ocupada_intercambia
    src = filled.first
    sp_box = species_at(src)
    sp_party = party[2]
    assert move('party/2', src)['applied']
    assert_equal sp_box, party[2]
    assert_equal sp_party, species_at(src)
    @h.call('undo')
    assert_original
  end

  def test_intercambio_dentro_del_equipo
    before = party
    assert move('party/0', 'party/3')['applied']
    after = party
    assert_equal [before[3], before[1], before[2], before[0]], [after[0], after[1], after[2], after[3]]
    @h.call('undo')
    assert_original
  end

  def test_el_equipo_no_puede_quedar_vacio
    slots = []
    5.times do
      dst = empty_slot(slots)
      slots << dst
      assert move('party/0', dst)['applied']
    end
    assert_equal 1, party.size
    err = assert_raises(DriverError) { move('party/0', empty_slot(slots)) }
    assert_equal 'PartyTooSmall', err.error_type
    err = assert_raises(DriverError) { @h.call('apply_ops', ops: [{ op: 'pokemon.remove', ref: 'party/0' }]) }
    assert_equal 'PartyTooSmall', err.error_type
    5.times { @h.call('undo') }
    assert_original
  end

  def test_liberar_de_caja_y_de_equipo
    src = filled.first
    assert @h.call('apply_ops', ops: [{ op: 'pokemon.remove', ref: src }])['applied']
    assert_nil species_at(src)
    assert @h.call('apply_ops', ops: [{ op: 'pokemon.remove', ref: 'party/1' }])['applied']
    assert_equal 5, party.size
    2.times { @h.call('undo') }
    assert_original
  end

  def test_refs_invalidos_dan_error_claro
    assert_equal 'UnknownRef', assert_raises(DriverError) { move('box/999/0', 'party/0') }.error_type
    assert_equal 'UnknownRef', assert_raises(DriverError) { move('party/0', 'box/0/99') }.error_type
    assert_equal 'UnknownRef', assert_raises(DriverError) { move('party/0', 'cosa/1') }.error_type
    assert_equal 'UnknownRef', assert_raises(DriverError) { move('party/0', 'party/9') }.error_type
    assert_equal 'PokemonNotFound', assert_raises(DriverError) { move(empty_slot, 'party/0') }.error_type
    assert_original
  end

  def test_mover_a_si_mismo_no_cambia_nada
    r = move('party/0', 'party/0')
    refute r['applied']
    assert_equal 'no_changes', r['reason']
  end

  def test_editar_caja_nombre_y_fondo
    r = @h.call('apply_ops', ops: [{ op: 'box.patch', index: 1, name: 'Mis favoritos', background: 3 }])
    assert r['applied'], r.inspect
    b = boxes[1]
    assert_equal 'Mis favoritos', b['name']
    assert_equal 3, b['background']
    @h.call('undo')
    assert_original
  end

  def test_la_etiqueta_del_cambio_lleva_origen_y_destino
    move('party/0', 'party/1')
    label = @h.call('list_history')['undo'].last['label']
    assert_equal 'op.pokemon.move', label['key']
    assert_equal 'party/0', label['params']['ref']
    assert_equal 'party/1', label['params']['to']
  end

  def test_secuencia_aleatoria_de_movimientos_y_deshacer_todo_devuelve_bytes_identicos
    rng = Random.new(7)
    done = 0
    60.times do
      spots = ((0...party.size).map { |i| "party/#{i}" } + filled + [empty_slot, "party/#{party.size}"])
      from = spots.sample(random: rng)
      to = spots.sample(random: rng)
      begin
        r = move(from, to)
        done += 1 if r['applied']
      rescue DriverError
        # PartyFull / PartyTooSmall / PokemonNotFound: legitimos, no dejan nada aplicado
      end
    end
    assert_operator done, :>, 10
    @h.call('undo_all')
    assert_original
  end

  def test_guardar_y_reabrir_conserva_el_movimiento
    with_save_copy('Partida_2.rxdata') do |path|
      h = Harness.new
      h.open(path)
      dst = nil
      h.call('list_boxes')['storage']['boxes'].each do |b|
        i = b['slots'].index(nil)
        (dst = "box/#{b['index']}/#{i}"; break) if i
      end
      sp = h.call('get_pokemon', ref: 'party/5')['pokemon']['species']['id']
      h.call('apply_ops', ops: [{ op: 'pokemon.move', from: 'party/5', to: dst }])
      assert h.call('save')['applied']

      h2 = Harness.new
      h2.open(path)
      assert_equal true, h2.call('verify_roundtrip')['roundtripClean']
      assert_equal 5, h2.call('list_party')['party'].size
      assert_equal sp, h2.call('get_pokemon', ref: dst)['pokemon']['species']['id']
    end
  end
end
