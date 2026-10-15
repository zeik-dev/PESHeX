require 'test_helper'
require_relative 'fixtures/real_games'

# Cache en disco del Store (datos leidos del juego) y precarga sin partida abierta.
class StoreCacheTest < Minitest::Test
  include RealGames

  def setup
    @cache = Dir.mktmpdir('peshex_cache')
    @own_root = nil
  end

  def teardown
    FileUtils.rm_rf(@cache)
    FileUtils.rm_rf(@own_root) if @own_root
  end

  # Copia propia del juego (para poder modificar sus archivos sin tocar la compartida por los demas tests).
  def own_game(key = :anil)
    shared = real_game_root(key)
    @own_root = Dir.mktmpdir('peshex_cache_game')
    FileUtils.cp_r(File.join(shared, '.'), @own_root)
    @own_root
  end

  def cache_files
    Dir.glob(File.join(@cache, 'store-*.bin'))
  end

  def test_la_cache_da_ida_y_vuelta_el_mismo_store
    root = own_game
    store = Sem::GameData::Store.load(root, source: 'manual')
    fp = Sem::GameData::StoreCache.write(@cache, store)
    assert_match(/\A\h{32}\z/, fp)
    assert_equal 1, cache_files.size

    back = Sem::GameData::StoreCache.read(@cache, root, 'auto')
    assert back&.loaded?, 'se hidrata ya cargado'
    assert_equal 'auto', back.source, 'la fuente es la de ESTA vinculacion'
    assert_equal root, back.root
    assert_equal store.state, back.state
    %i[species moves items abilities types].each { |d| assert_equal store.count(d), back.count(d), d.to_s }
    assert_equal store.limits, back.limits
    assert_equal store.version, back.version
    assert_equal store.species_entry('ARCANINE', 1).egg_moves, back.species_entry('ARCANINE', 1).egg_moves
    # los derivados perezosos se recalculan sobre los datos hidratados
    assert back.move_learnable?('ARCANINE', 1, 100, 'HEADSMASH')
    assert_equal store.prevos('SNEASLER'), back.prevos('SNEASLER')
    assert back.form_exists?('MRRIME', 1)
  end

  def test_cualquier_cambio_en_los_archivos_del_juego_invalida_la_cache
    root = own_game
    store = Sem::GameData::Store.load(root)
    Sem::GameData::StoreCache.write(@cache, store)
    assert Sem::GameData::StoreCache.valid?(@cache, root)
    before = Sem::GameData::StoreCache.fingerprint(root)

    File.open(File.join(root, 'PBS', 'moves.txt'), 'a') { |f| f.write("\n# edicion\n") }
    refute_equal before, Sem::GameData::StoreCache.fingerprint(root)
    refute Sem::GameData::StoreCache.valid?(@cache, root)
    assert_nil Sem::GameData::StoreCache.read(@cache, root, 'manual'), 'huella distinta: se vuelve a leer todo'

    # al guardar la nueva se borra la antigua: no se acumulan caches
    Sem::GameData::StoreCache.write(@cache, Sem::GameData::Store.load(root))
    assert_equal 1, cache_files.size
  end

  def test_la_huella_no_depende_de_donde_este_la_carpeta
    a = own_game
    store_fp = Sem::GameData::StoreCache.fingerprint(a)
    moved = Dir.mktmpdir('peshex_cache_moved')
    FileUtils.cp_r(File.join(a, '.'), moved, preserve: true)
    assert_equal store_fp, Sem::GameData::StoreCache.fingerprint(moved), 'mismo contenido y fechas en otra ruta'
  ensure
    FileUtils.rm_rf(moved) if moved
  end

  def test_una_cache_danada_o_ajena_se_ignora_sin_romper
    root = own_game
    Sem::GameData::StoreCache.write(@cache, Sem::GameData::Store.load(root))
    path = cache_files.first
    File.binwrite(path, 'basura que no es Marshal')
    assert_nil Sem::GameData::StoreCache.read(@cache, root, 'manual')
    File.binwrite(path, Marshal.dump({ magic: 'OTRA-COSA' }))
    assert_nil Sem::GameData::StoreCache.read(@cache, root, 'manual')
    File.binwrite(path, Marshal.dump([1, 2, 3]))
    assert_nil Sem::GameData::StoreCache.read(@cache, root, 'manual')
    assert_nil Sem::GameData::StoreCache.read('', root, 'manual')
    assert_nil Sem::GameData::StoreCache.read(File.join(@cache, 'no-existe'), root, 'manual')
  end

  def test_escribir_en_una_carpeta_imposible_no_lanza
    root = own_game
    store = Sem::GameData::Store.load(root)
    blocker = File.join(@cache, 'es-un-archivo')
    File.write(blocker, 'x')
    assert_nil Sem::GameData::StoreCache.write(File.join(blocker, 'dentro'), store)
    assert_nil Sem::GameData::StoreCache.write(nil, store)
    assert_nil Sem::GameData::StoreCache.write(@cache, Sem::GameData::Store.new(root)), 'un Store sin cargar no se guarda'
  end

  # Vincular con cacheDir: la primera vez lee y escribe la cache; la segunda sale de ella (y el resultado es el mismo).
  def test_vincular_con_cache_la_segunda_vez_sale_de_la_cache
    with_save_copy('Partida.rxdata') do |path|
      root = own_game
      first = link_with_cache(path, root)
      assert_equal false, first[:cached]
      assert_equal 1, cache_files.size, 'al terminar de vincular se escribe la cache'

      second = link_with_cache(path, root)
      assert_equal true, second[:cached]
      assert_equal first[:species], second[:species]
      assert_equal first[:flags], second[:flags], 'la legalidad sale igual con los datos de la cache'
    end
  end

  def link_with_cache(save_path, root)
    h = Harness.new
    h.open(save_path)
    begin_r = h.call('game_link_begin', path: root, source: 'manual', cacheDir: @cache)
    begin_r['steps'].each { |s| h.call('game_link_step', step: s) }
    status = h.call('game_link_finish')['game']
    pk = h.call('get_pokemon', ref: 'party/0')['pokemon']
    { cached: begin_r['cached'], species: status.dig('data', 'domains', 'species', 'count') || status['data'].to_s.size,
      flags: pk['flags'].map { |f| f['code'] }.sort }
  end

  def test_la_precarga_sin_partida_escribe_la_cache_y_la_siguiente_ya_esta_lista
    root = own_game
    h = Harness.new # sin abrir ningun save
    b = h.call('game_preload_begin', path: root, cacheDir: @cache)
    assert_equal false, b['cached']
    assert_equal %w[species moves items abilities types extras settings], b['steps']
    b['steps'].each { |s| assert_equal s, h.call('game_preload_step', step: s)['step'] }
    f = h.call('game_preload_finish')
    assert_equal false, f['cached']
    assert_match(/\A\h{32}\z/, f['fingerprint'])
    assert_equal 'ready', f['state']
    assert_operator f['species'], :>, 1000
    assert_equal 1, cache_files.size

    again = h.call('game_preload_begin', path: root, cacheDir: @cache)
    assert_equal true, again['cached']
    assert_equal [], again['steps'], 'ya precargado: nada que leer'
    assert_equal true, h.call('game_preload_finish')['cached']
  end

  def test_la_precarga_exige_carpeta_de_cache_y_una_carpeta_de_juego_valida
    h = Harness.new
    root = own_game
    assert_equal 'ValidationError', assert_raises(DriverError) { h.call('game_preload_begin', path: root, cacheDir: '') }.error_type
    assert_raises(DriverError) { h.call('game_preload_begin', path: File.join(@cache, 'nada'), cacheDir: @cache) }
    assert_equal 'NoPendingGameLink', assert_raises(DriverError) { h.call('game_preload_step', step: 'species') }.error_type
  end
end

# El backup de cada partida lleva el nombre de SU save: con varias partidas en una carpeta no se mezclan.
class BackupsPerSaveTest < Minitest::Test
  def test_las_copias_de_cada_partida_se_nombran_con_la_suya_y_no_se_mezclan
    Dir.mktmpdir('peshex_multi') do |dir|
      a = File.join(dir, 'Game.rxdata')
      b = File.join(dir, 'Game2.rxdata')
      FileUtils.cp(File.join(SAVES_DIR, 'Partida_2.rxdata'), a)
      FileUtils.cp(File.join(SAVES_DIR, 'Partida_2.rxdata'), b)
      [a, b].each do |path|
        h = Harness.new
        h.open(path)
        h.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 777 }], mode: 'hax')
        assert h.call('save')['applied']
      end
      baks = Dir.children(dir).grep(/\.bak\z/).sort
      assert_equal 2, baks.size
      assert baks.any? { |f| f.match?(/\AGame\.rxdata\.\d{8}-\d{6}\.bak\z/) }, baks.inspect
      assert baks.any? { |f| f.match?(/\AGame2\.rxdata\.\d{8}-\d{6}\.bak\z/) }, baks.inspect

      [a, b].each do |path|
        h = Harness.new
        h.open(path)
        listed = h.call('list_backups')['backups'].map { |x| x['file'] }
        assert_equal 1, listed.size, "#{File.basename(path)} solo ve su copia: #{listed.inspect}"
        assert listed.first.start_with?("#{File.basename(path)}."), listed.inspect
      end
    end
  end
end
