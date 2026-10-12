require 'test_helper'

# Capa semantica sobre los saves reales de test_saves/ (base custom derivada de
# Essentials 21.1). Solo lectura: no se modifica ningun archivo.
class SemanticTest < Minitest::Test
  def setup
    @h = Harness.new
    @open = @h.open(save_path('Partida_2.rxdata'))
  end

  def test_detecta_perfil_savedata_con_confianza_alta
    p = @open['profile']
    assert_equal 'essentials_savedata', p['id']
    assert_equal 'high', p['confidence']
    assert_equal '21.1', p['essentialsVersion']
    assert_equal 'hash_root', p['format']
    assert_equal 'symbol', p['idStyle']
    assert_equal 'hash', p['statLayout']
    assert_empty p['ambiguities']
    assert_equal %w[bag global pokedex stats storage trainer], p['roles'].keys.sort
    assert_equal '.player', p['roles']['trainer']['path']
    assert_equal '.bag', p['roles']['bag']['path']
    assert_equal '.storage_system', p['roles']['storage']['path']
  end

  def test_detecta_el_overlay_de_base_custom_como_posible
    overlay = @open['profile']['overlays'].find { |o| o['id'] == 'sky_v21' }
    assert overlay, 'deberia sugerir el overlay por item_log/randomized_data/@favourite_items'
    assert_equal 'possible', overlay['confidence']
  end

  def test_overview_entrenador_y_equipo
    ov = @h.call('get_overview')
    t = ov['trainer']
    assert_equal 'Furikita', t['name']
    assert_equal 26_350, t['money']
    assert_equal 8, t['badges'].size
    assert_equal 1, t['badges'].count(true)
    assert_operator t['playTime'], :>, 0
    assert_match(/\A\d{4}-\d\d-\d\dT/, t['lastSaved'])
    assert_equal %w[GUMSHOOS TORRACAT PAWMOT SPIDOPS LOMBRE TOEDSCOOL], ov['party'].map { |x| x['species']['id'] }
    assert_equal 6, ov['party'].size
    assert_equal({ 'seen' => 122, 'owned' => 26 }, ov['pokedex'])
    assert_equal 50, ov['counts']['boxes']
    assert_equal 11, ov['counts']['boxPokemon']
  end

  def test_detalle_de_pokemon_normaliza_iv_y_ev
    pk = @h.call('get_pokemon', ref: 'party/0')['pokemon']
    assert_equal 'GUMSHOOS', pk['species']['id']
    assert_equal 23, pk['level']
    assert_equal %w[HP ATTACK DEFENSE SPECIAL_ATTACK SPECIAL_DEFENSE SPEED], pk['iv'].keys
    assert_equal 30, pk['iv']['HP']
    assert_equal 350, pk['evTotal']
    assert_equal 'hash', pk['ivLayout']
    assert_equal 4, pk['moves'].size
    assert_equal 'Furikita', pk['owner']['name']
    assert_equal '.player@party[0]', pk['fieldPath']
    custom = pk['extras'].select { |e| e['custom'] }.map { |e| e['name'] }
    assert_includes custom, '@legacy_data', 'los ivars de plugins deben salir como extras custom'
  end

  def test_pokemon_compartido_se_avisa
    pk = @h.call('get_pokemon', ref: 'party/1')['pokemon']
    assert_includes pk['shared'], '.variables@data[803]'
  end

  def test_bolsa_por_bolsillos_con_el_indice_cero_reservado
    bag = @h.call('get_bag')['bag']
    assert_equal 'pockets', bag['layout']
    assert_equal %w[items medicine pokeballs tmhm berries mail battle key], bag['pockets'].map { |p| p['key'] }
    assert_equal [1, 2, 3, 4, 5, 6, 7, 8], bag['pockets'].map { |p| p['index'] }
    slot = bag['pockets'][1]['slots'].first
    assert_equal 'POTION', slot['id']
    assert_equal 6, slot['qty']
    assert_equal 'bag/2/0', slot['ref']
  end

  def test_pc_con_cajas_y_resumenes
    st = @h.call('list_boxes')['storage']
    assert_equal 50, st['boxes'].size
    assert_equal 30, st['boxes'][0]['slots'].size
    assert_equal 'Caja 1', st['boxes'][0]['name']
    assert_equal 11, st['total']
    assert_equal 'box/0/0', st['boxes'][0]['slots'].compact.first['ref'] if st['boxes'][0]['slots'][0]
  end

  def test_la_cobertura_suma_exactamente_los_campos_del_collector
    cov = @h.call('get_coverage')
    fields = @h.call('build_index')['fieldCount']
    assert_equal fields, cov['total']
    assert_operator cov['buckets']['classified'], :>, 0
    assert_operator cov['buckets']['custom'], :>, 0
    assert_operator cov['buckets']['world'], :>, 0
  end

  def test_los_extras_custom_aparecen_en_la_lista_de_todo_detectado
    custom = @h.call('list_unclassified', bucket: 'custom', pageSize: 200)['groups'].map { |g| g['key'] }
    assert_includes custom, 'Pokemon#@legacy_data'
    assert_includes custom, '(raiz)#item_log'
  end

  def test_locate_field_devuelve_el_indice_de_la_vista_avanzada
    r = @h.call('locate_field', path: '.player@money')
    assert r['found']
    row = @h.call('get_field', index: r['index'])
    assert_equal '.player@money', row['path']
  end

  def test_perfil_forzado_y_perfil_desconocido
    forced = @h.call('set_profile_override', profileId: 'generic')
    assert_equal 'generic', forced['profile']['id']
    assert_equal true, forced['profile']['confirmed']
    err = assert_raises(DriverError) { @h.call('set_profile_override', profileId: 'nope') }
    assert_equal 'UnknownProfile', err.error_type
  end
end

# Save grande (9 MB): rendimiento y cobertura exacta.
class SemanticLargeSaveTest < Minitest::Test
  def test_apertura_rapida_y_208_pokemon
    h = Harness.new
    t = Time.now
    r = h.open(save_path('Partida.rxdata'))
    ov = h.call('get_overview')
    elapsed = Time.now - t
    assert_operator elapsed, :<, 4.0, "abrir + resumen tardo #{elapsed.round(2)}s (objetivo < 3 s)"
    assert_equal 'high', r['profile']['confidence']
    assert_equal 208, r['profile']['counts']['pokemon']
    assert_equal 'Zeik', ov['trainer']['name']
    assert_equal 200, ov['counts']['boxPokemon']
  end

  def test_cobertura_exacta_en_el_save_grande
    h = Harness.new
    h.open(save_path('Partida.rxdata'))
    cov = h.call('get_coverage')
    assert_equal 319_710, cov['total']
  end
end
