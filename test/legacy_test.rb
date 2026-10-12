require 'test_helper'
require_relative 'fixtures/make_legacy_save'

# Bases antiguas (Essentials v16-v18) y variantes custom, sobre saves SINTETICOS
# (ver fixtures/make_legacy_save.rb). Los perfiles ≤v18 estan sin contrastar con
# saves reales: estos tests fijan el comportamiento esperado de la deteccion.
class LegacyTest < Minitest::Test
  def open_bytes(bytes, h = Harness.new)
    Dir.mktmpdir('pbs_legacy') do |dir|
      path = File.join(dir, 'Game.rxdata')
      File.binwrite(path, bytes)
      yield h, h.open(path), path
    end
  end

  def test_detecta_el_perfil_legacy_multi_root
    open_bytes(LegacyFixture.build) do |_h, r, _|
      p = r['profile']
      assert_equal 'essentials_legacy', p['id']
      assert_equal 'multi_root', p['format']
      assert_equal 'integer', p['idStyle']
      assert_equal 'array', p['statLayout']
      assert_equal 'high', p['confidence']
      assert_equal 'profile', p['roles']['trainer']['via']
      assert_equal '$0', p['roles']['trainer']['path']
      assert_equal %w[bag global storage trainer], p['roles'].keys.sort
    end
  end

  def test_entrenador_y_equipo_legacy
    open_bytes(LegacyFixture.build) do |h, _r, _|
      ov = h.call('get_overview')
      t = ov['trainer']
      assert_equal 'Red', t['name']
      assert_equal 3000, t['money']
      assert_equal 250, t['coins'], 'las fichas viven en PokemonGlobalMetadata en las bases antiguas'
      assert_equal 3, t['badges'].count(true)
      assert_in_delta 3086.4, t['playTime'], 0.1 # frame_count / 40
      assert_equal [25, 4], ov['party'].map { |x| x['species']['id'] }
      assert_equal 'Sparky', ov['party'][0]['nickname']
    end
  end

  def test_iv_y_ev_en_array_se_normalizan_al_orden_de_pbstats
    open_bytes(LegacyFixture.build) do |h, _r, _|
      pk = h.call('get_pokemon', ref: 'party/0')['pokemon']
      assert_equal 'array', pk['ivLayout']
      # [HP, ATK, DEF, SPEED, SPATK, SPDEF] = [31, 20, 10, 5, 15, 25]
      assert_equal({ 'HP' => 31, 'ATTACK' => 20, 'DEFENSE' => 10, 'SPECIAL_ATTACK' => 15,
                     'SPECIAL_DEFENSE' => 25, 'SPEED' => 5 }, pk['iv'])
      assert_equal 508, pk['evTotal']
      assert_equal 'Red', pk['owner']['name']
    end
  end

  def test_bolsa_pc_con_ids_enteros
    open_bytes(LegacyFixture.build) do |h, _r, _|
      bag = h.call('get_bag')['bag']
      assert_equal [17, 18], bag['pockets'][0]['slots'].map { |s| s['id'] }
      assert_equal 'pokeballs', bag['pockets'][2]['key']
      st = h.call('list_boxes')['storage']
      assert_equal 3, st['boxes'].size
      assert_equal 129, st['boxes'][0]['slots'][0]['species']['id']
    end
  end

  def test_la_bolsa_en_bag_se_detecta_igual_por_forma
    open_bytes(LegacyFixture.build(bag_ivar: '@bag')) do |h, r, _|
      assert_equal '$13', r['profile']['roles']['bag']['path']
      assert_equal '@bag', r['profile']['roles']['bag']['ivar']
      assert_equal 3, h.call('get_bag')['bag']['pockets'].count { |p| p['count'].positive? }
    end
  end

  def test_bolsa_vacia_se_reconoce_por_la_clase
    open_bytes(LegacyFixture.build(empty_bag: true)) do |h, r, _|
      assert r['profile']['roles']['bag'], 'una bolsa vacia con clase *Bag* debe enlazarse'
      assert_equal 0, h.call('get_bag')['bag']['totalItems']
    end
  end

  def test_un_root_desconocido_aparece_sin_clasificar_y_nunca_se_pierde
    extra = LegacyFixture.obj('ModdedThing', secret: [1, 2, 3], label: 'hola')
    open_bytes(LegacyFixture.build(extra_root: extra)) do |h, _r, _|
      un = h.call('list_unclassified', bucket: 'unclassified')
      assert_includes un['groups'].map { |g| g['class'] }, 'ModdedThing'
      cov = h.call('get_coverage')
      assert_equal h.call('build_index')['fieldCount'], cov['total']
    end
  end

  def test_editar_en_una_base_legacy_y_guardar
    open_bytes(LegacyFixture.build) do |h, _r, path|
      orig = h.session.doc.to_bytes
      ok = h.call('apply_ops', ops: [
                    { op: 'set', ref: 'trainer', field: 'money', value: 9999 },
                    { op: 'pokemon.patch', ref: 'party/0', patch: { level: 30, iv: { SPEED: 31 }, ev: { HP: 4 } } },
                    { op: 'bag.set', pocket: 1, id: 17, qty: 9 },
                    { op: 'bag.set', pocket: 1, id: 19, qty: 3 }
                  ])
      assert ok['applied'], ok.inspect
      pk = h.call('get_pokemon', ref: 'party/0')['pokemon']
      assert_equal 31, pk['iv']['SPEED']
      assert_equal [17, 18, 19], h.call('get_bag')['bag']['pockets'][0]['slots'].map { |s| s['id'] }
      h.call('undo')
      assert_equal orig, h.session.doc.to_bytes

      h.call('redo')
      assert h.call('save')['applied']
      h2 = Harness.new
      h2.open(path)
      assert_equal 9999, h2.call('get_trainer')['trainer']['money']
      assert_equal true, h2.call('verify_roundtrip')['roundtripClean']
    end
  end

  def test_un_save_moderno_no_se_confunde_con_legacy
    h = Harness.new
    r = h.open(save_path('Partida_2.rxdata'))
    assert_equal 'essentials_savedata', r['profile']['id']
    alt = r['profile']['alternatives'].map { |a| a['id'] }
    assert_includes alt, 'essentials_legacy'
    assert_operator r['profile']['alternatives'].find { |a| a['id'] == 'essentials_legacy' }['score'], :<, 0.3
  end
end

# Un save de forma desconocida: confianza baja -> solo lectura hasta confirmar.
class UnknownBaseTest < Minitest::Test
  def test_save_desconocido_es_solo_lectura_y_sus_datos_van_a_sin_clasificar
    Dir.mktmpdir('pbs_unknown') do |dir|
      path = File.join(dir, 'Rare.rxdata')
      File.binwrite(path, Marshal.dump({ 'cosa' => [1, 2, 3], 'otra' => 'x' }))
      h = Harness.new
      r = h.open(path)
      assert_equal 'low', r['profile']['confidence']
      assert_equal false, r['profile']['editable']
      err = assert_raises(DriverError) { h.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 1 }]) }
      assert_equal 'ReadOnlyProfile', err.error_type
      cov = h.call('get_coverage')
      assert_equal cov['total'], h.call('build_index')['fieldCount']
      assert_operator cov['buckets']['unclassified'], :>, 0
    end
  end
end
