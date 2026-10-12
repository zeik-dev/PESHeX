require 'test_helper'

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
