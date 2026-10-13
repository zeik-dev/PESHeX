require 'test_helper'
require_relative 'fixtures/make_game_folder'

T = Sem::GameData::Tables

# Tablas y formulas embebidas (no dependen de ningun juego).
class GameTablesTest < Minitest::Test
  def test_experiencia_nivel_100_de_cada_grupo
    expected = { 'Medium' => 1_000_000, 'Erratic' => 600_000, 'Fluctuating' => 1_640_000,
                 'Parabolic' => 1_059_860, 'Fast' => 800_000, 'Slow' => 1_250_000 }
    expected.each { |rate, exp| assert_equal exp, T.exp_at(rate, 100), rate }
    expected.each_key { |rate| assert_equal 0, T.exp_at(rate, 1), rate }
  end

  def test_nivel_por_experiencia_es_la_inversa
    T::GROWTH_RATES.each do |rate|
      [2, 17, 36, 50, 69, 99, 100].each do |lv|
        assert_equal lv, T.level_for_exp(rate, T.exp_at(rate, lv)), "#{rate} nivel #{lv}"
        assert_equal lv - 1, T.level_for_exp(rate, T.exp_at(rate, lv) - 1), "#{rate} justo antes de #{lv}" if lv > 2
      end
    end
  end

  def test_25_naturalezas_y_multiplicadores
    assert_equal 25, T::NATURES.size
    assert_equal 110, T.nature_multiplier('ADAMANT', 'ATTACK')
    assert_equal 90, T.nature_multiplier('ADAMANT', 'SPECIAL_ATTACK')
    assert_equal 100, T.nature_multiplier('HARDY', 'ATTACK')
    assert_equal 100, T.nature_multiplier('NO_EXISTE', 'ATTACK')
  end

  def test_formulas_de_stats
    # Base 100, nivel 50, IV 31, EV 252: (2*100 + 31 + 252/4) * 50 / 100 = 147.
    assert_equal 207, T.calc_hp(100, 50, 31, 252)       # 147 + nivel + 10
    assert_equal 152, T.calc_stat(100, 50, 31, 252, 100) # 147 + 5
    assert_equal 167, T.calc_stat(100, 50, 31, 252, 110) # 152 * 1.1 = 167,2
    assert_equal 136, T.calc_stat(100, 50, 31, 252, 90)  # 152 * 0.9 = 136,8
    assert_equal 1, T.calc_hp(1, 100, 31, 252), 'Shedinja siempre tiene 1 PS'
  end
end

# Lectura de PBS (respaldo para bases antiguas o carpetas de desarrollo).
class PbsParserTest < Minitest::Test
  PBS = Sem::GameData::Pbs

  def test_items_csv_antiguo
    items = PBS.items("# comentario\n1,MASTERBALL,Master Ball,Master Balls,3,0,Atrapa todo.,0,0,0,\n17,POTION,Poción,Pociones,2,300,Cura 20 PS.,1,3,0,\n")
    assert_equal %w[MASTERBALL POTION], items.map(&:id)
    assert_equal 'Poción', items.last.name
    assert_equal 2, items.last.pocket
    assert_equal 17, items.last.number
  end

  def test_especies_ini_v19
    text = "[BULBASAUR]\nName = Bulbasaur\nTypes = GRASS,POISON\nBaseStats = 45,49,49,45,65,65\nGenderRatio = FemaleOneEighth\n" \
           "GrowthRate = Parabolic\nMoves = 1,TACKLE,3,GROWL\nAbilities = OVERGROW\nEvolutions = IVYSAUR,Level,16\n"
    sp = PBS.species(text).first
    assert_equal 'BULBASAUR', sp.id
    assert_equal %w[GRASS POISON], sp.types
    # El PBS lista la velocidad antes que Atq.Esp./Def.Esp.
    assert_equal({ 'HP' => 45, 'ATTACK' => 49, 'DEFENSE' => 49, 'SPEED' => 45, 'SPECIAL_ATTACK' => 65, 'SPECIAL_DEFENSE' => 65 }, sp.base_stats)
    assert_equal [[1, 'TACKLE'], [3, 'GROWL']], sp.moves
    assert_equal 'Parabolic', sp.growth_rate
    assert_equal 16, sp.evolutions.first[:param]
  end

  def test_especies_ini_con_formas
    sp = PBS.species("[BULBASAUR,1]\nName = Bulbasaur\nFormName = Mega\n")
    assert_equal 'BULBASAUR_1', sp.first.id
    assert_equal 1, sp.first.form
  end

  def test_csv_respeta_comillas_con_comas
    assert_equal ['6', 'HONEY', 'Miel', 'Su aroma, muy dulce, atrae.', '2'], PBS.csv_split('6,HONEY,Miel,"Su aroma, muy dulce, atrae.",2')
    assert_equal ['1', 'Dice "hola"', ''], PBS.csv_split('1,"Dice ""hola""",')
  end

  def test_items_csv_con_descripcion_con_comas_no_desplaza_columnas
    text = "6,HONEY,Miel,Mieles,1,100,\"Atrae Pokémon, cuevas o árboles.\",2,0,0,\n" \
           "288,TM01,MT01,MT01s,4,3000,\"Ventisca, helada.\",3,0,0,BLIZZARD\n"
    honey, tm = PBS.items(text)
    assert_equal 2, honey.field_use
    refute honey.machine?, 'una descripcion con comas no convierte un objeto en MT'
    assert_equal 'Atrae Pokémon, cuevas o árboles.', honey.description
    assert tm.machine?
    assert_equal 'BLIZZARD', tm.move
  end

  def test_abilities_csv_conserva_la_descripcion_completa
    ab = PBS.abilities("1,STENCH,Hedor,\"Puede hacer retroceder, repele.\"\n").first
    assert_equal 'Puede hacer retroceder, repele.', ab.description
  end

  def test_evoluciones_con_parametro_vacio
    evo = PBS.triples_evo('ESPEON,HappinessDay,,UMBREON,HappinessNight,,SYLVEON,Item,SHINYSTONE')
    assert_equal %w[ESPEON UMBREON SYLVEON], evo.map { |e| e[:species] }
    assert_nil evo[0][:param]
    assert_equal 'SHINYSTONE', evo[2][:param]
    assert_equal ['IVYSAUR'], PBS.triples_evo('IVYSAUR,Level,16,').map { |e| e[:species] }
  end

  def test_movimientos_de_nivel_menos_uno_se_conservan
    assert_equal [[-1, 'AMNESIA'], [0, 'WORRYSEED'], [1, 'TACKLE']], PBS.pairs_moves('-1,AMNESIA,0,WORRYSEED,1,TACKLE')
  end

  def test_claves_ini_sin_distinguir_mayusculas
    sp = PBS.species("[PIKACHU]\nName = Pikachu\npokedex = Un ratón, eléctrico.\nHatchSteps = 2560\n").first
    assert_equal 'Un ratón, eléctrico.', sp.pokedex
    assert_equal 2560, sp.hatch_steps
  end

  def test_formas_heredan_de_la_especie_base_y_el_listado_tiene_orden
    base = "[BULBASAUR]\nName = Bulbasaur\nTypes = GRASS,POISON\nBaseStats = 45,49,49,45,65,65\nGrowthRate = Parabolic\n" \
           "[IVYSAUR]\nName = Ivysaur\nTypes = GRASS,POISON\nBaseStats = 60,62,63,60,80,80\n"
    forms = "[IVYSAUR,1]\nFormName = Mega\nMegaStone = IVYSAURITE\nBaseStats = 80,100,123,80,122,120\n"
    list = PBS.species_with_forms(base, forms)
    mega = list.find { |s| s.id == 'IVYSAUR_1' }
    assert_equal 'Ivysaur', mega.name
    assert_equal %w[GRASS POISON], mega.types
    assert_equal 80, mega.base_stats['HP']
    assert_equal 'IVYSAURITE', mega.mega[:stone]
    assert_equal [1, 2, 2], list.map(&:order)
  end

  def test_tm_txt_une_las_lineas_de_cada_movimiento
    tm = PBS.tm("# TMs\n[VENOSHOCK]\nBULBASAUR,IVYSAUR,\nVENUSAUR\n[SCALD]\nSQUIRTLE,\n")
    assert_equal %w[BULBASAUR IVYSAUR VENUSAUR], tm['VENOSHOCK']
    assert_equal ['SQUIRTLE'], tm['SCALD']
  end

  def test_encuentros_de_los_dos_formatos
    legacy = PBS.encounters("#####\n007 # Ruta 1\n12,2,2\nLand\nBIDOOF,3,5\nFLETCHLING,3,5\nOldRod\nKRABBY,4,6\n")
    assert_equal 'Ruta 1', legacy.first[:name]
    assert_equal [20, 20], legacy.first[:tables].first[:slots].map { |s| s[:chance] }
    modern = PBS.encounters("[002] # Pueblo Paleta\nLand,12\n    25,PIDGEY,2,4\n    10,MAREEP,2\nSuperRod\n    100,MARILL,4,6\n")
    assert_equal 2, modern.first[:map]
    assert_equal [25, 10], modern.first[:tables].first[:slots].map { |s| s[:chance] }
    assert_equal 2, modern.first[:tables].first[:slots].last[:max]
    assert_equal 'SuperRod', modern.first[:tables].last[:type]
  end
end

# Carpeta de juego sintetica derivada de Partida_2 (nada oficial).
class GameDataTest < Minitest::Test
  @@dir = nil

  def self.fixture_dir
    @@dir ||= Dir.mktmpdir('peshex_game').tap do |d|
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
    @h.call('set_game_folder', path: self.class.fixture_dir, source: 'manual')
  end

  def test_sin_carpeta_el_estado_es_no_vinculado_y_legalidad_basica
    st = @h.call('get_game_status')['game']
    refute st['linked']
    assert_equal 'basic', st['legality']['level']
    assert_includes st['legality']['reasons'], 'no_game_folder'
  end

  def test_vincular_carga_los_datos_y_sube_la_revision
    rev = @h.session.revision
    st = link['game']
    assert st['linked']
    assert_equal 'ready', st.dig('data', 'state')
    assert_equal 'v21', st.dig('data', 'version')
    assert_equal 'Fixture Game', st['title']
    %w[species moves items abilities].each { |d| assert_operator st.dig('data', 'domains', d, 'count'), :>, 0, d }
    assert_equal 'dat', st.dig('data', 'domains', 'species', 'source')
    assert_operator @h.session.revision, :>, rev, 'cambia lo que muestran las vistas'
    assert_equal @original, @h.session.doc.to_bytes, 'vincular no toca el documento'
    refute @h.session.dirty?
  end

  def test_los_limites_salen_de_settings_y_las_expresiones_se_ignoran
    st = link['game']
    assert_equal 50, st.dig('limits', 'boxCount')
    assert_equal 10, st.dig('limits', 'maxPlayerName')
    assert_equal 9_999, st.dig('limits', 'maxSoot'), 'MAX_SOOT usa una expresion: queda el valor por defecto'
    assert_equal '001_Settings.rb', st.dig('limitSources', 'boxCount')
    assert_equal 50, @h.call('get_trainer')['trainer']['limits']['boxCount']
  end

  def test_los_nombres_del_juego_ganan_sobre_los_embebidos
    before = @h.call('list_party')['party'].map { |p| p.dig('species', 'name') }
    link
    after = @h.call('list_party')['party'].map { |p| p.dig('species', 'name') }
    assert_includes after, 'Gatito Fuego'
    refute_includes before, 'Gatito Fuego'
    assert_equal before.size, after.size
  end

  def test_la_calibracion_confirma_que_los_datos_explican_el_save
    cal = link.dig('game', 'calibration')
    %w[species stats moves abilities].each do |d|
      assert_equal 'ok', cal.dig(d, 'status'), "#{d}: #{cal[d].inspect}"
    end
    assert_equal 'full', link.dig('game', 'legality', 'level')
  end

  def test_una_carpeta_que_no_es_de_este_save_se_detecta
    Dir.mktmpdir('peshex_game_other') do |dir|
      GameFixture.build(dir, from: save_path('Partida.rxdata'))
      st = @h.call('set_game_folder', path: dir)['game']
      assert_equal 'mismatch', st.dig('calibration', 'species', 'status')
      assert_equal 'basic', st.dig('legality', 'level')
      assert_includes st.dig('legality', 'reasons'), 'species_mismatch'
    end
  end

  def test_catalogo_y_ficha_de_especie
    link
    cat = @h.call('get_catalog')['catalog']
    assert_equal %w[abilities items moves natures ribbons species types], cat.keys.sort
    assert_equal 25, cat['natures'].size
    assert(cat['species'].any? { |s| s['id'] == 'TORRACAT' && s['name'] == 'Gatito Fuego' })
    only = @h.call('get_catalog', kinds: %w[moves])['catalog']
    assert_equal ['moves'], only.keys

    sp = @h.call('get_species', id: 'TORRACAT')['species']
    assert_equal 6, sp['baseStats'].size
    assert_equal 'Gatito Fuego', sp['name']
    assert_includes sp['hiddenAbilities'], 'FIXTUREHIDDEN'
    err = assert_raises(DriverError) { @h.call('get_species', id: 'NOEXISTE') }
    assert_equal 'SpeciesNotFound', err.error_type
  end

  def test_calc_stats_reproduce_los_stats_guardados
    link
    r = @h.call('calc_stats', ref: 'party/0')
    assert r['match'], r.inspect
    assert r['trusted']
    assert_equal r['cached'], r['stats']
    pk = @h.call('get_pokemon', ref: 'party/0')['pokemon']
    assert_equal r['expAtNext'] > pk['exp'], true

    loose = @h.call('calc_stats', species: 'TORRACAT', level: 50, nature: 'ADAMANT',
                                  iv: { HP: 31, ATTACK: 31 }, ev: { ATTACK: 252 })
    assert_equal loose['baseStats'].keys.sort, loose['stats'].keys.sort
  end

  def test_exp_y_nivel
    link
    r = @h.call('exp_for_level', species: 'TORRACAT', level: 30)
    assert_equal T.exp_at(r['growthRate'], 30), r['exp']
    back = @h.call('exp_for_level', species: 'TORRACAT', exp: r['exp'])
    assert_equal 30, back['level']
  end

  def test_desvincular_restaura_los_nombres_embebidos
    link
    r = @h.call('set_game_folder', path: nil)['game']
    refute r['linked']
    names = @h.call('list_party')['party'].map { |p| p.dig('species', 'name') }
    refute_includes names, 'Gatito Fuego'
  end

  def test_no_se_cambia_la_carpeta_con_cambios_pendientes
    @h.call('apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 1 }])
    err = assert_raises(DriverError) { link }
    assert_equal 'PendingChanges', err.error_type
  end

  def test_carpeta_invalida_y_subcarpeta_data
    err = assert_raises(DriverError) { @h.call('set_game_folder', path: '/no/existe/jamas') }
    assert_equal 'GameFolderInvalid', err.error_type
    Dir.mktmpdir('peshex_vacio') do |d|
      err = assert_raises(DriverError) { @h.call('set_game_folder', path: d) }
      assert_equal 'NotAGameFolder', err.error_type
    end
    # Elegir la subcarpeta Data (error comun) sube un nivel hasta la raiz.
    st = @h.call('set_game_folder', path: File.join(self.class.fixture_dir, 'Data'))['game']
    assert_equal File.expand_path(self.class.fixture_dir), st['root']
  end

  def test_sin_carpeta_las_acciones_que_la_necesitan_fallan_con_codigo
    %w[get_catalog calc_stats].each do |cmd|
      err = assert_raises(DriverError) { @h.call(cmd, ref: 'party/0') }
      assert_equal 'GameFolderRequired', err.error_type
    end
  end

  def test_open_sugiere_la_carpeta_solo_si_esta_junto_al_save
    with_save_copy('Partida_2.rxdata') do |path|
      h = Harness.new
      assert_nil h.call('open', path: path, autodetect: true)['gameSuggestion']
      FileUtils.cp_r(Dir[File.join(self.class.fixture_dir, '*')], File.dirname(path))
      sug = Harness.new.call('open', path: path, autodetect: true)['gameSuggestion']
      assert_equal File.realpath(File.dirname(path)), File.realpath(sug)
    end
  end

  def test_los_datos_de_juego_no_se_leen_con_marshal_load
    # (sin minitest/mock: en Ruby 4 / minitest 6 ya no viene con minitest/autorun)
    calls = 0
    original = Marshal.method(:load)
    Marshal.singleton_class.send(:define_method, :load) { |*_a, **_k| calls += 1 }
    begin
      link
    ensure
      Marshal.singleton_class.send(:define_method, :load, original)
    end
    assert_equal 0, calls, 'Marshal.load no debe usarse con archivos del juego'
  end
end
