require 'test_helper'
require 'stringio'

# Protocolo real (proceso hijo) + registro de comandos.
class ProtocolTest < Minitest::Test
  def test_ping_open_y_errores_por_protocolo
    client = DriverClient.new
    begin
      assert_equal true, client.call('ping')['pong']

      r = client.call('open', path: save_path('Partida_2.rxdata'), autodetect: false)
      assert r['ok'], r.inspect
      assert_equal false, r['roundtripChecked'], 'el roundtrip se verifica de forma perezosa'
      assert_equal 'idle', r['indexState'], 'abrir no debe construir el Collector'
      assert_equal true, client.call('verify_roundtrip')['roundtripClean']
      assert_equal 0, r['revision']

      bad = client.call('bogus')
      refute bad['ok']
      assert_equal 'ProtocolError', bad.dig('error', 'type')

      client.call('close')
      sin_sesion = client.call('list_fields')
      assert_equal 'NoSessionOpen', sin_sesion.dig('error', 'type')
    ensure
      client.close
    end
  end

  # La clave `id` de la peticion es el numero de peticion del protocolo: un comando que la use como parametro recibe
  # el contador (bug de 1.0.0 con get_species). Estas llamadas van por el protocolo REAL (proceso hijo).
  def test_comandos_de_la_carpeta_del_juego_por_el_protocolo_real
    require_relative 'fixtures/make_game_folder'
    dir = Dir.mktmpdir('peshex_proto')
    GameFixture.build(dir, from: save_path('Partida_2.rxdata'), names: { 'TORRACAT' => 'Gatito Fuego' })
    client = DriverClient.new
    begin
      assert client.call('open', path: save_path('Partida_2.rxdata'), autodetect: false)['ok']
      begin_r = client.call('game_link_begin', path: dir)
      assert begin_r['ok'], begin_r.inspect
      begin_r['steps'].each { |step| assert client.call('game_link_step', step: step)['ok'], "paso #{step}" }
      assert client.call('game_link_finish')['ok']

      sp = client.call('get_species', species: 'TORRACAT', form: 0)
      assert sp['ok'], sp.inspect
      assert_equal 'TORRACAT', sp.dig('species', 'id')
      assert sp.dig('species', 'baseStats', 'HP')
      assert_kind_of Array, sp.dig('species', 'learnable')
      extras = client.call('get_species_extras', species: 'TORRACAT')
      assert extras['ok'], extras.inspect
    ensure
      client.close
      FileUtils.rm_rf(dir)
    end
  end

  # Regresion (1.1.0): get_species_extras devolvia `id` y pisaba el de la respuesta; el crate Rust lo toma por
  # desincronizacion y da de baja la sesion («No save is open» y el resto de vistas sin datos tras abrir una ficha).
  def test_la_respuesta_conserva_el_id_de_la_peticion_aunque_el_comando_devuelva_id_u_ok
    out = StringIO.new
    real = $stdout
    $stdout = out
    begin
      Protocol.ok_response(7, { id: 'BULBASAUR', ok: false, 'id' => 99, extra: 1 }, revision: 3)
    ensure
      $stdout = real
    end
    resp = JSON.parse(out.string)
    assert_equal 7, resp['id']
    assert_equal true, resp['ok']
    assert_equal 3, resp['revision']
    assert_equal 1, resp['extra']
  end

  def test_los_comandos_de_la_ficha_responden_con_el_id_de_su_peticion_por_el_protocolo_real
    require_relative 'fixtures/make_game_folder'
    dir = Dir.mktmpdir('peshex_ids')
    GameFixture.build(dir, from: save_path('Partida_2.rxdata'))
    client = DriverClient.new # verifica el `id` de CADA respuesta
    begin
      assert client.call('open', path: save_path('Partida_2.rxdata'), autodetect: false)['ok']
      begin_r = client.call('game_link_begin', path: dir)
      begin_r['steps'].each { |step| client.call('game_link_step', step: step) }
      client.call('game_link_finish')
      sp = client.call('get_catalog')['catalog']['species']
      first = sp.first
      3.times do
        assert client.call('get_species', species: first['species'], form: 0)['ok']
        extras = client.call('get_species_extras', species: first['species'], form: 0)
        assert extras['ok']
        assert_equal first['species'], extras['species']
      end
      assert client.call('get_pokedex')['ok']
    ensure
      client.close
      FileUtils.rm_rf(dir)
    end
  end

  def test_indice_de_campos_es_perezoso
    h = Harness.new
    h.open(save_path('Partida_2.rxdata'))
    assert_equal 'idle', h.call('index_status')['state']
    page = h.call('list_fields', filterPath: 'player@money', pageSize: 3)
    assert_equal 1, page['total']
    ready = h.call('index_status')
    assert_equal 'ready', ready['state']
    assert_operator ready['fieldCount'], :>, 30_000
  end

  def test_registro_de_comandos_incluye_los_historicos
    %w[ping check open close shutdown list_fields get_field set_field list_changes nil_report save].each do |name|
      assert Commands.fetch(name), "falta el comando #{name}"
    end
  end
end
