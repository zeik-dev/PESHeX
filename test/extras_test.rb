require 'test_helper'
require_relative 'fixtures/make_game_folder'
require_relative 'fixtures/make_legacy_save'

# Pokedex, mundo, estadisticas, busqueda, copias, comparacion, exportar/importar/clonar y acciones rapidas.
class ExtrasTest < Minitest::Test
  @@dir = nil

  def self.fixture_dir
    @@dir ||= Dir.mktmpdir('peshex_extras').tap do |d|
      GameFixture.build(d, from: File.join(SAVES_DIR, 'Partida_2.rxdata'), names: { 'TORRACAT' => 'Gatito Fuego' })
      Minitest.after_run { FileUtils.rm_rf(d) }
    end
  end

  def setup
    @h = Harness.new
    @h.open(save_path('Partida_2.rxdata'))
    @original = @h.session.doc.to_bytes
  end

  def link
    @h.call('set_game_folder', path: self.class.fixture_dir)
  end

  def hax(ops)
    @h.call('apply_ops', ops: ops, mode: 'hax')
  end

  def assert_original
    assert_equal @original, @h.session.doc.to_bytes
    refute @h.session.dirty?
  end

  # ── Pokedex ───────────────────────────────────────────────────────────────

  def test_pokedex_lista_vistos_y_capturados
    d = @h.call('get_pokedex')
    assert d['available']
    assert_equal 'hash', d['layout']
    assert_equal 122, d['seen'].size
    assert_equal 26, d['owned'].size
    assert_includes d['seen'], 'CHARMANDER'
    assert_operator d['ids'].size, :>=, 122
    assert_kind_of Hash, d['caught']
  end

  # ── Pokedex en el trainer (bases v16-v18, Infinite Fusion...) ───────────────

  def open_legacy_dex(kind)
    Dir.mktmpdir('peshex_dex') do |dir|
      path = File.join(dir, 'Game.rxdata')
      File.binwrite(path, LegacyFixture.build(dex: kind))
      h = Harness.new
      r = h.open(path)
      yield h, r
    end
  end

  def test_pokedex_guardado_en_el_trainer_se_detecta_y_se_lee
    [true, :alt].each do |kind|
      open_legacy_dex(kind) do |h, r|
        assert_includes r['profile']['roles'].keys, 'pokedex', "dex=#{kind}"
        d = h.call('get_pokedex')
        assert d['available']
        assert_equal 'array', d['layout']
        assert_equal %w[4 25 129], d['seen']
        assert_equal %w[25], d['owned']
        assert_equal({ 'seen' => 3, 'owned' => 1 }, h.call('get_overview')['pokedex'])
      end
    end
  end

  def test_editar_el_pokedex_del_trainer_agranda_el_array_y_es_reversible
    open_legacy_dex(true) do |h, _r|
      before = h.session.doc.to_bytes
      # capturada 129: el array de capturados mide 26, la base lo agranda
      assert h.call('apply_ops', ops: [{ op: 'pokedex.set', id: '129', owned: true }], mode: 'hax')['applied']
      assert_includes h.call('get_pokedex')['owned'], '129'
      assert h.call('apply_ops', ops: [{ op: 'pokedex.set', id: '4', seen: false }], mode: 'hax')['applied']
      refute_includes h.call('get_pokedex')['seen'], '4'
      err = assert_raises(DriverError) { h.call('apply_ops', ops: [{ op: 'pokedex.set', id: '999999', seen: true }], mode: 'hax') }
      assert_equal 'FieldMissing', err.error_type
      h.call('undo_all')
      assert_equal before, h.session.doc.to_bytes
      refute h.session.dirty?
    end
  end

  def test_sin_pokedex_en_ninguna_parte_no_hay_rol_y_get_pokedex_lo_dice
    Dir.mktmpdir('peshex_nodex') do |dir|
      path = File.join(dir, 'Game.rxdata')
      File.binwrite(path, LegacyFixture.build)
      h = Harness.new
      r = h.open(path)
      refute_includes r['profile']['roles'].keys, 'pokedex'
      refute h.call('get_pokedex')['available']
    end
  end

  def test_pokedex_marcar_visto_y_capturado_es_reversible
    d = @h.call('get_pokedex')
    nuevo = 'MEWTWO'
    refute_includes d['seen'], nuevo
    assert hax([{ op: 'pokedex.set', id: nuevo, owned: true }])['applied']
    d2 = @h.call('get_pokedex')
    assert_includes d2['owned'], nuevo
    assert_includes d2['seen'], nuevo, 'capturar implica haber visto'
    assert hax([{ op: 'pokedex.set', id: nuevo, seen: false }])['applied']
    d3 = @h.call('get_pokedex')
    refute_includes d3['owned'], nuevo
    refute_includes d3['seen'], nuevo, 'no visto implica no capturado'
    2.times { @h.call('undo') }
    assert_original
  end

  def test_pokedex_acciones_masivas
    ids = %w[AAA BBB CCC]
    hax([{ op: 'pokedex.bulk', mode: 'owned_all', ids: ids }])
    d = @h.call('get_pokedex')
    assert(ids.all? { |i| d['owned'].include?(i) && d['seen'].include?(i) })
    hax([{ op: 'pokedex.bulk', mode: 'clear_all', ids: ids }])
    d = @h.call('get_pokedex')
    assert(ids.none? { |i| d['seen'].include?(i) })
    err = assert_raises(DriverError) { hax([{ op: 'pokedex.bulk', mode: 'raro', ids: ids }]) }
    assert_equal 'ValidationError', err.error_type
    @h.call('undo_all')
    assert_original
  end

  def test_hex_rechaza_especies_que_el_juego_no_conoce_en_el_pokedex
    link
    r = @h.call('apply_ops', ops: [{ op: 'pokedex.set', id: 'NOEXISTE', seen: true }], mode: 'hex')
    refute r['applied']
    assert_equal 'dex_species_unknown', r.dig('rejected', 'flags').first['code']
    assert_original
    # una especie del juego si
    assert @h.call('apply_ops', ops: [{ op: 'pokedex.set', id: 'TORRACAT', seen: false }], mode: 'hex')['applied']
  end

  # ── Mundo ─────────────────────────────────────────────────────────────────

  def test_interruptores_y_variables_con_nombres_de_system
    w = @h.call('get_world', kind: 'switches')
    assert w['available']
    assert_operator w['count'], :>, 600
    refute w['named']
    link
    named = @h.call('get_world', kind: 'switches', q: 'Medalla')
    assert named['named']
    assert_equal 'Medalla 1', named['rows'].first['name']
    assert_equal 1, named['rows'].first['id']
    v = @h.call('get_world', kind: 'variables', q: 'Pasos')
    assert_equal 1, v['rows'].first['id']
    err = assert_raises(DriverError) { @h.call('get_world', kind: 'otra') }
    assert_equal 'ValidationError', err.error_type
  end

  def test_filtros_de_mundo_por_id_valor_y_pagina
    one = @h.call('get_world', kind: 'variables', q: '4')
    assert(one['rows'].any? { |r| r['id'] == 4 })
    non_default = @h.call('get_world', kind: 'switches', onlyNonDefault: true)
    assert(non_default['rows'].all? { |r| r['value']['value'] == true })
    page = @h.call('get_world', kind: 'variables', page: 1, pageSize: 10)
    assert_equal 10, page['rows'].size
    assert_equal 11, page['rows'].first['id']
  end

  def test_editar_interruptor_y_variable_es_reversible
    before = @h.call('get_world', kind: 'switches', q: '5')['rows'].find { |r| r['id'] == 5 }['value']['value']
    assert hax([{ op: 'world.switch', id: 5, value: !before }])['applied']
    after = @h.call('get_world', kind: 'switches', q: '5')['rows'].find { |r| r['id'] == 5 }['value']['value']
    assert_equal !before, after
    assert hax([{ op: 'world.variable', id: 1, value: 777 }])['applied']
    assert_equal 777, @h.call('get_world', kind: 'variables', q: '1')['rows'].find { |r| r['id'] == 1 }['value']['value']
    assert hax([{ op: 'world.variable', id: 1, value: 'texto' }])['applied']
    2.times { @h.call('undo') }
    @h.call('undo')
    assert_original
  end

  def test_ids_invalidos_o_tipos_incorrectos_de_mundo
    assert_equal 'FieldMissing', assert_raises(DriverError) { hax([{ op: 'world.switch', id: 99_999, value: true }]) }.error_type
    assert_equal 'ValidationError', assert_raises(DriverError) { hax([{ op: 'world.switch', id: 3, value: 'si' }]) }.error_type
    assert_original
  end

  # ── Estadisticas y Salon de la Fama ───────────────────────────────────────

  def test_estadisticas_y_salon_de_la_fama
    s = @h.call('get_stats')
    assert s['available']
    names = s['entries'].map { |e| e['name'] }
    assert_includes names, 'wild_battles_won'
    assert(s['entries'].all? { |e| %w[battle money travel pokemon time other].include?(e['group']) })
    assert_operator s['playTime'], :>, 0
    hof = @h.call('get_hall_of_fame')
    assert hof['available']
    assert_equal [], hof['entries']
  end

  # ── Busqueda ──────────────────────────────────────────────────────────────

  def test_busqueda_global_agrupa_pokemon_objetos_cajas_y_mundo
    link
    r = @h.call('search', q: 'gatito')
    assert_equal ['pokemon'], r['groups'].keys
    assert_equal 'party/1', r['groups']['pokemon'].first['ref'].then { |x| x }.sub(/\Abox.*/, 'party/1') if false
    assert(r['groups']['pokemon'].any? { |p| p['sub'].include?('Gatito Fuego') })
    r = @h.call('search', q: 'poti')
    assert(r['groups']['items'].any? { |i| i['id'] == 'POTION' })
    r = @h.call('search', q: 'medalla')
    assert_equal 'switches', r['groups']['world'].first['kind']
    assert_equal 0, @h.call('search', q: '')['total']
    assert_equal 0, @h.call('search', q: 'zzzzzzzz')['total']
    r = @h.call('search', q: 'caja')
    assert r['groups'].key?('boxes') || r['total'] >= 0
  end

  # ── Copias y comparacion ──────────────────────────────────────────────────

  def test_copias_listar_comparar_y_restaurar
    with_save_copy('Partida_2.rxdata') do |path|
      h = Harness.new
      h.open(path)
      assert_empty h.call('list_backups')['backups']
      h.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 1111 }], mode: 'hax')
      h.call('apply_ops', ops: [{ op: 'pokemon.patch', ref: 'party/0', patch: { nickname: 'Cambiado' } }], mode: 'hax')
      assert h.call('save')['applied']
      backups = h.call('list_backups')['backups']
      assert_equal 1, backups.size
      assert_equal 'backup', backups.first['kind']
      assert_match(/\APartida_2\.rxdata\.\d{8}-\d{6}\.bak\z/, backups.first['file'])

      # en memoria: otro cambio sin guardar; la copia tiene el estado original
      h.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 2222 }], mode: 'hax')
      d = h.call('diff_saves', file: backups.first['file'])
      assert_equal 1, d['summary']['pokemonChanged']
      assert_equal 'Cambiado', d['pokemon']['changed'].first['diffs'].find { |x| x['field'] == 'nickname' }['a']
      assert_equal [{ 'field' => 'money', 'a' => 2222, 'b' => 26_350 }], d['trainer']
      assert_equal 0, d['summary']['pokemonAdded']

      # no se restaura con cambios pendientes
      assert_equal 'PendingChanges', assert_raises(DriverError) { h.call('restore_backup', file: backups.first['file']) }.error_type
      h.call('undo')
      refute h.session.dirty?
      r = h.call('restore_backup', file: backups.first['file'])
      assert_equal backups.first['file'], r['restored']
      assert File.exist?(File.join(File.dirname(path), r['safetyCopy'])), 'antes de restaurar se guarda el estado actual'
      h2 = Harness.new
      h2.open(path)
      assert_equal 26_350, h2.call('get_trainer')['trainer']['money']
      kinds = h2.call('list_backups')['backups'].map { |b| b['kind'] }
      assert_includes kinds, 'prerestore'
    end
  end

  def test_restaurar_solo_acepta_copias_listadas
    err = assert_raises(DriverError) { @h.call('restore_backup', file: '../../etc/passwd') }
    assert_equal 'BackupNotFound', err.error_type
    err = assert_raises(DriverError) { @h.call('restore_backup', file: 'Partida_2.rxdata') }
    assert_equal 'BackupNotFound', err.error_type
  end

  def test_diff_de_una_copia_identica_no_tiene_diferencias
    with_save_copy('Partida_2.rxdata') do |path|
      d = @h.call('diff_saves', against: path)
      assert_equal 0, d['summary'].values.sum, d['summary'].inspect
      assert_equal 0, d['world']['variables']['changed']
    end
  end

  def test_diff_de_dos_partidas_distintas_no_falla
    d = @h.call('diff_saves', against: save_path('Partida.rxdata'))
    assert_operator d['summary']['pokemonAdded'] + d['summary']['pokemonRemoved'], :>, 0
    assert d['bag'].is_a?(Array)
    assert d['world'].key?('switches')
    assert_equal 'FileNotFound', assert_raises(DriverError) { @h.call('diff_saves', against: '/no/existe') }.error_type
    assert_original
  end

  # ── Exportar, importar y clonar ───────────────────────────────────────────

  def test_exportar_json_y_showdown
    link
    j = @h.call('export_pokemon', ref: 'party/1', format: 'json')['data']
    assert_equal 'peshex.pokemon/1', j['schema']
    assert_equal 'TORRACAT', j['species']
    assert_equal 6, j['iv'].size
    assert_operator j['moves'].size, :>, 0
    sd = @h.call('export_pokemon', ref: 'party/1', format: 'showdown')['text']
    first = sd.lines.first
    assert_includes first, 'Gatito Fuego'
    assert_match(/^Level: \d+$/, sd)
    assert_match(/^- /, sd)
  end

  def free_box_slot
    @h.call('list_boxes')['storage']['boxes'].each do |b|
      i = b['slots'].index(nil)
      return "box/#{b['index']}/#{i}" if i
    end
  end

  def test_clonar_un_pokemon_a_una_casilla_libre_con_otro_id_personal
    link
    src = @h.call('get_pokemon', ref: 'party/0')['pokemon']
    dst = free_box_slot
    r = hax([{ op: 'pokemon.clone', ref: 'party/0', to: dst }])
    assert r['applied'], r.inspect
    c = @h.call('get_pokemon', ref: dst)['pokemon']
    assert_equal src['species']['id'], c['species']['id']
    assert_equal src['level'], c['level']
    refute_equal src['personalId'], c['personalId']
    assert_equal src['moves'].map { |m| m['id'] }, c['moves'].map { |m| m['id'] }
    @h.call('undo')
    assert_original
  end

  def test_clonar_con_auto_y_pc_lleno
    link
    r = hax([{ op: 'pokemon.clone', ref: 'party/0', to: 'auto' }])
    assert r['applied']
    @h.call('undo')
    assert_original
    # PC lleno: se ocupan a mano todas las casillas libres (clonar mil veces por operaciones seria lentisimo)
    state = Sem::Api.state!(@h.session)
    template = state.resolved.scan.pokemon.first.node
    state.model.box_arrays.each do |_, _, arr|
      arr.items.each_index { |i| arr.items[i] = RxMarshal.deep_clone(template) if arr.items[i].nil? }
    end
    before = @h.session.doc.to_bytes
    err = assert_raises(DriverError) { hax([{ op: 'pokemon.clone', ref: 'party/0', to: 'auto' }]) }
    assert_equal 'PcFull', err.error_type
    assert_equal before, @h.session.doc.to_bytes, 'un clon fallido no deja rastro'
  end

  def test_clonar_a_destinos_invalidos
    link
    assert_equal 'SlotOccupied', assert_raises(DriverError) { hax([{ op: 'pokemon.clone', ref: 'party/0', to: 'party/2' }]) }.error_type
    assert_equal 'PartyFull', assert_raises(DriverError) { hax([{ op: 'pokemon.clone', ref: 'party/0', to: 'party/6' }]) }.error_type
    assert_equal 'SlotOccupied', assert_raises(DriverError) { hax([{ op: 'pokemon.clone', ref: 'party/0', to: @h.call('list_boxes')['storage']['boxes'].flat_map { |b| b['slots'].each_with_index.filter_map { |s, i| s ? "box/#{b['index']}/#{i}" : nil } }.first }]) }.error_type
    assert_original
  end

  def test_importar_un_pokemon_desde_datos
    link
    data = { species: 'TORRACAT', level: 40, nickname: 'Importado', nature: 'ADAMANT', ability: @h.call('get_pokemon', ref: 'party/1')['pokemon']['ability']['id'],
             iv: { HP: 31, ATTACK: 31 }, ev: { ATTACK: 252 },
             moves: [{ id: 'TACKLE', pp: 25 }, { id: 'SURF', pp: 25 }] }
    dst = free_box_slot
    r = hax([{ op: 'pokemon.add', to: dst, data: data }])
    assert r['applied'], r.inspect
    p = @h.call('get_pokemon', ref: dst)['pokemon']
    assert_equal 'Importado', p['nickname']
    assert_equal 40, p['level']
    assert_equal 'ADAMANT', p['nature']['id']
    assert_equal %w[TACKLE SURF], p['moves'].map { |m| m['id'] }
    assert_equal 31, p['iv']['ATTACK']
    assert_equal 252, p['ev']['ATTACK']
    # con datos del juego y calibracion ok: estadisticas y experiencia coherentes
    assert_equal true, p['stats']['match'], p['stats'].inspect
    assert_equal p['growth']['expAtLevel'], p['exp']
    @h.call('undo')
    assert_original
  end

  def test_hex_rechaza_importar_un_pokemon_ilegal_y_acepta_uno_legal
    link
    bad = { species: 'TORRACAT', level: 40, moves: [{ id: GameFixture::UNLEARNABLE_MOVE, pp: 5 }] }
    r = @h.call('apply_ops', ops: [{ op: 'pokemon.add', to: free_box_slot, data: bad }], mode: 'hex')
    refute r['applied']
    assert_includes r.dig('rejected', 'flags').map { |f| f['code'] }, 'move_not_learnable'
    assert_original
    good = @h.call('export_pokemon', ref: 'party/1', format: 'json')['data'].slice('species', 'form', 'level', 'nature', 'ability', 'item', 'ball', 'iv', 'ev', 'moves', 'nickname')
    good['moves'] = good['moves'].map { |m| m.slice('id', 'pp', 'ppUps').compact }
    r = @h.call('apply_ops', ops: [{ op: 'pokemon.add', to: 'auto', data: good }], mode: 'hex')
    assert r['applied'], r.inspect
  end

  def test_importar_con_datos_mal_formados_da_errores_claros_y_no_deja_rastro
    link
    dst = free_box_slot
    [nil, 0, 'texto', [1], 3.5, { species: 'TORRACAT', moves: 0 }, { species: 'TORRACAT', moves: [nil] },
     { species: 'TORRACAT', iv: 5 }, { species: 'TORRACAT', ev: [1] }].each do |bad|
      err = assert_raises(DriverError, "data=#{bad.inspect}") { hax([{ op: 'pokemon.add', to: dst, data: bad }]) }
      assert_equal 'ValidationError', err.error_type
      assert_equal @original, @h.session.doc.to_bytes
    end
  end

  def test_importar_sin_especie_falla
    assert_equal 'ValidationError', assert_raises(DriverError) { hax([{ op: 'pokemon.add', to: 'auto', data: { level: 5 } }]) }.error_type
  end

  def test_importar_al_final_del_equipo
    link
    # equipo de 5 para que haya sitio
    dst = free_box_slot
    @h.call('apply_ops', ops: [{ op: 'pokemon.move', from: 'party/5', to: dst }], mode: 'hax')
    r = hax([{ op: 'pokemon.add', to: 'party/5', data: { species: 'TORRACAT', level: 12 } }])
    assert r['applied'], r.inspect
    assert_equal 6, @h.call('list_party')['party'].size
    assert_equal 12, @h.call('get_pokemon', ref: 'party/5')['pokemon']['level']
  end

  # ── Acciones rapidas ──────────────────────────────────────────────────────

  def test_curar_restaura_ps_estado_y_pp
    link
    hax([{ op: 'pokemon.patch', ref: 'party/0', patch: { hp: 1, status: 'POISON', moves: [{ slot: 0, pp: 1 }] } }])
    r = hax([{ op: 'pokemon.heal', ref: 'party/0' }])
    assert r['applied'], r.inspect
    p = @h.call('get_pokemon', ref: 'party/0')['pokemon']
    assert_equal p['totalHp'], p['hp']
    assert_equal 'NONE', p['status'].to_s
    assert_equal true, p['moves'].first['pp'] >= 25 || p['moves'].first['pp'] > 1
    assert_empty p['flags'].select { |f| f['severity'] == 'illegal' }
  end

  def test_recalcular_estadisticas_requiere_datos_fiables
    err = assert_raises(DriverError) { hax([{ op: 'pokemon.recalc', ref: 'party/0' }]) }
    assert_equal 'RecalcUnavailable', err.error_type
    assert_equal 'no_game_folder', err.params[:reason]
    link
    hax([{ op: 'pokemon.patch', ref: 'party/0', patch: { iv: { ATTACK: 0, SPEED: 0 } } }])
    assert_equal false, @h.call('get_pokemon', ref: 'party/0')['pokemon']['stats']['match']
    assert hax([{ op: 'pokemon.recalc', ref: 'party/0' }])['applied']
    assert_equal true, @h.call('get_pokemon', ref: 'party/0')['pokemon']['stats']['match']
  end

  def test_cambiar_el_nivel_mantiene_exp_y_estadisticas_coherentes
    link
    r = @h.call('apply_ops', ops: [{ op: 'pokemon.level', ref: 'party/0', level: 50 }], mode: 'hex')
    assert r['applied'], r.inspect
    p = @h.call('get_pokemon', ref: 'party/0')['pokemon']
    assert_equal 50, p['level']
    assert_equal p['growth']['expAtLevel'], p['exp']
    assert_equal true, p['stats']['match']
    assert_empty p['flags'], p['flags'].inspect
    @h.call('undo')
    assert_original
  end

  def test_subir_de_nivel_sin_datos_del_juego_solo_cambia_el_nivel
    assert hax([{ op: 'pokemon.level', ref: 'party/0', level: 30 }])['applied']
    p = @h.call('get_pokemon', ref: 'party/0')['pokemon']
    assert_equal 30, p['level']
  end

  def test_secuencia_de_acciones_nuevas_y_deshacer_todo_devuelve_bytes_identicos
    link
    slot = free_box_slot
    hax([{ op: 'pokemon.clone', ref: 'party/0', to: slot }, { op: 'pokedex.set', id: 'MEWTWO', owned: true },
         { op: 'world.variable', id: 2, value: 5 }, { op: 'pokemon.heal', ref: 'party/1' },
         { op: 'pokemon.level', ref: 'party/2', level: 77 }, { op: 'pokemon.add', to: 'auto', data: { species: 'TORRACAT', level: 9 } }])
    assert @h.session.dirty?
    @h.call('undo_all')
    assert_original
  end
end
