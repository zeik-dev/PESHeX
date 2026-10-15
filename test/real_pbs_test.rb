require 'test_helper'
require_relative 'fixtures/real_games'

# Lectura de los PBS REALES de test_pbs/ (Pokémon Z = Essentials v16-18, Pokémon Añil = v21). Se omite sin test_pbs/.
class RealPbsTest < Minitest::Test
  include RealGames

  # ── Pokémon Z (v16-18: CSV, ids enteros, [N] + InternalName) ─────────────
  def test_z_cuenta_y_formato_antiguo
    st = real_store(:z)
    assert_equal 'ready', st.state
    assert_equal 1018, st.count(:species)
    assert_equal 730, st.count(:moves)
    assert_equal 256, st.count(:abilities)
    assert_equal 19, st.count(:types)
    assert_equal 1, st.species_entry('BULBASAUR').number
    assert_equal 'BULBASAUR', st.species_entry(1).id, 'el id entero del save se resuelve por el numero de seccion'
  end

  def test_z_las_mt_se_detectan_sin_falsos_positivos
    st = real_store(:z)
    machines = st.table(:items).values.select(&:machine?)
    assert_equal 114, machines.size
    refute st.item('HONEY').machine?, 'la descripcion con comas desplazaba las columnas de HONEY'
    tm = st.item('TM01')
    assert_equal ['MT01', 'BLIZZARD', 4, 3], [tm.name, tm.move, tm.pocket, tm.field_use]
    assert_equal 'Ventisca', st.move('BLIZZARD').name
  end

  def test_z_descripciones_completas_y_tipos_con_id_interno
    st = real_store(:z)
    assert_operator st.ability('STENCH').description.length, :>, 40
    refute_includes st.ability('STENCH').description, '"'
    assert_equal %w[NORMAL FIGHTING FLYING], st.types.first(3).map(&:id)
    assert_equal %w[FIGHTING], st.types.first.weaknesses
    assert_equal %w[GHOST], st.types.first.immunities
  end

  def test_z_evoluciones_con_parametro_vacio_y_datos_de_pokedex
    st = real_store(:z)
    evo = st.species_entry('EEVEE').evolutions.to_h { |e| [e[:species], e[:method]] }
    assert_equal 'HappinessDay', evo['ESPEON']
    assert_equal 'HappinessNight', evo['UMBREON']
    b = st.species_entry('BULBASAUR')
    assert_equal({ 'SPECIAL_ATTACK' => 1 }, b.ev_yield)
    assert_equal [45, 70, 5355, 0.7, 6.9], [b.catch_rate, b.happiness, b.hatch_steps, b.height, b.weight]
    assert_equal %w[Monster Grass], b.egg_groups
    assert_equal %w[Green Grassland Seed], [b.color, b.habitat, b.category]
    assert_includes b.pokedex, 'napping in bright sunlight'
  end

  def test_z_tm_txt_alimenta_los_movimientos_aprendibles
    st = real_store(:z)
    assert_operator st.species_entry('BULBASAUR').tm_moves.size, :>, 10
    assert_includes st.species_entry('BULBASAUR').tm_moves, 'VENOSHOCK'
    assert st.move_learnable?('BULBASAUR', 0, 5, 'VENOSHOCK'), 'una MT cuenta como aprendible'
  end

  def test_z_encuentros_con_nombre_de_mapa
    st = real_store(:z)
    assert_operator st.encounter_maps.size, :>, 100
    hit = st.encounters_for('FLETCHLING').find { |r| r[:name] == 'Ruta 1' }
    assert hit, 'FLETCHLING aparece en la Ruta 1'
    assert_equal ['Land', 3, 5, 20], [hit[:method], hit[:min], hit[:max], hit[:chance]]
  end

  # ── Pokémon Añil (v21: INI con símbolos, formas con diferencias) ─────────
  def test_anil_cuenta_formas_y_orden_nacional
    st = real_store(:anil)
    assert_equal 1519, st.count(:species)
    assert_equal 851, st.count(:moves)
    assert_equal 328, st.count(:abilities)
    assert_nil st.species_entry('BULBASAUR').number
    assert_equal [1, 2, 3], %w[BULBASAUR IVYSAUR VENUSAUR].map { |id| st.species_entry(id).order }
  end

  def test_anil_formas_heredan_y_conservan_datos_propios
    st = real_store(:anil)
    mega = st.species_entry('VENUSAUR', 1)
    assert_equal 'Venusaur', mega.name
    assert_equal 'Mega Venusaur X', mega.form_name
    assert_equal %w[GRASS POISON], mega.types
    assert_equal 100, mega.base_stats['ATTACK']
    assert_equal 'VENUSAURITEX', mega.mega[:stone]
  end

  def test_anil_movimientos_de_nivel_menos_uno_y_mt
    st = real_store(:anil)
    assert_operator st.table(:species).values.sum { |s| s.moves.count { |lv, _| lv < 0 } }, :>, 400
    assert_equal 131, st.table(:items).values.count(&:machine?)
    assert_equal ['MT01', 'BLIZZARD'], [st.item('TM01').name, st.item('TM01').move]
  end

  def test_anil_eevee_y_datos_de_apoyo
    st = real_store(:anil)
    evo = st.species_entry('EEVEE').evolutions.to_h { |e| [e[:species], [e[:method], e[:param]]] }
    assert_equal ['HappinessDay', nil], evo['ESPEON']
    assert_equal 80, st.ribbons.size
    assert_equal 9, st.regional_dexes.size
    assert_equal({ 0 => 1 }, st.regional_numbers('BULBASAUR'))
    pidgey = st.encounters_for('PIDGEY').find { |r| r[:method] == 'Land' && r[:name] == 'Pueblo Paleta' }
    assert_equal [2, 4, 25], [pidgey[:min], pidgey[:max], pidgey[:chance]]
    assert_equal %w[FIGHTING], st.types.find { |t| t.id == 'NORMAL' }.weaknesses
  end
end

# El catalogo y la ficha que consume la UI, sobre los PBS reales.
class RealCatalogTest < Minitest::Test
  include RealGames

  def test_catalogo_lleva_la_fila_del_icono_de_cada_tipo_y_el_indice_de_bola
    %i[z anil].each do |key|
      types = Sem::GameData::Catalog.types_list(real_store(key))
      assert_equal 10, types.find { |t| t[:id] == 'FIRE' }[:iconPosition], "#{key}: fila de FIRE en types.png"
      assert_equal 9, types.find { |t| t[:id] == 'QMARKS' }[:iconPosition]
    end
    z_items = Sem::GameData::Catalog.items_list(real_store(:z))
    assert_equal 1, z_items.find { |i| i[:id] == 'GREATBALL' }[:ballIndex], 'Z: indice de $BallTypes (summaryball01)'
    assert_nil z_items.find { |i| i[:id] == 'POTION' }[:ballIndex], 'solo las bolas lo llevan'
    assert(Sem::GameData::Catalog.items_list(real_store(:anil)).all? { |i| i[:ballIndex].nil? }, 'v21 nombra los iconos por id, no por indice')
  end

  def test_catalogo_lleva_numeros_y_orden_para_resolver_ids_enteros
    cat = Sem::GameData::Catalog.build(real_store(:z))
    bulba = cat[:species].find { |s| s[:id] == 'BULBASAUR' }
    assert_equal [1, 1], [bulba[:number], bulba[:order]]
    assert_equal 1, cat[:moves].first[:number]
    assert cat[:items].find { |i| i[:id] == 'TM01' }[:machine]
    normal = cat[:types].find { |t| t[:id] == 'NORMAL' }
    assert_equal %w[FIGHTING], normal[:weaknesses]
    assert_equal [], cat[:ribbons], 'Z no trae ribbons.txt'
  end

  def test_ficha_de_especie_con_datos_de_pokedex_mt_y_formas
    detail = Sem::GameData::Catalog.species_detail(real_store(:anil), 'VENUSAUR', 0)
    assert_equal 'Venusaur', detail[:name]
    assert_equal 80, detail[:baseStats]['HP']
    assert_includes detail[:tutorMoves], 'BODYSLAM'
    assert_equal 'Semilla', detail.dig(:info, :category)
    assert_equal [1, 'Mega Venusaur X'], detail[:forms].map { |f| [f[:form], f[:formName]] }.first
    mega = Sem::GameData::Catalog.species_detail(real_store(:anil), 'VENUSAUR', 1)
    assert_equal 'Mega Venusaur X', mega[:formName]
    assert_equal 'Semilla', mega.dig(:info, :category), 'la forma hereda la categoria'
    z = Sem::GameData::Catalog.species_detail(real_store(:z), 1, 0)
    assert_equal 'BULBASAUR', z[:id], 'un id entero (save v16-18) resuelve la ficha'
    assert_includes z[:tmMoves], 'VENOSHOCK'
  end

  def test_get_species_extras_por_el_comando
    h = Harness.new
    h.open(save_path('Partida_2.rxdata'))
    h.session.game = real_store(:anil)
    out = h.call('get_species_extras', { 'species' => 'PIDGEY' })
    assert_equal 'PIDGEY', out['species']
    refute out.key?('id'), '`id` es del protocolo: un comando no lo devuelve'
    assert_operator out['encounters'].size, :>, 0
    assert_equal 'Pueblo Paleta', out['encounters'].first['name']
    assert_kind_of Hash, out['regional']
  end
end

class RealLearnableTest < Minitest::Test
  include RealGames

  def test_learnable_incluye_nivel_tutor_mt_huevo_y_preevoluciones
    anil = Sem::GameData::Catalog.species_detail(real_store(:anil), 'IVYSAUR', 0)
    assert_includes anil[:learnable], 'VINEWHIP'      # nivel
    assert_includes anil[:learnable], 'AMNESIA'       # tutor / huevo
    assert_includes anil[:learnable], 'TACKLE'        # de su preevolución
    refute_includes anil[:learnable], 'SPLASH'
    z = Sem::GameData::Catalog.species_detail(real_store(:z), 2, 0)
    assert_includes z[:learnable], 'VENOSHOCK', 'MT de tm.txt'
    assert_includes z[:learnable], 'TACKLE'
  end
end

# Imagen del entrenador: clases de entrenador y jugadores de metadata.txt (Z = CSV + [000] PlayerA..F; Añil = INI + [N]).
class RealTrainerLookTest < Minitest::Test
  include RealGames

  def test_z_clases_de_entrenador_csv_y_jugadores_de_la_seccion_global
    z = real_store(:z)
    t = z.trainer_type(4)
    assert_equal ['POKEMONTRAINER_ChicoNegro', 'Entrenador', 4], [t.internal, t.name, t.id]
    assert_equal 4, z.trainer_type('pokemontrainer_chiconegro').id, 'por nombre, sin distinguir mayusculas'
    assert_nil z.trainer_type(9_999)
    assert_equal 'POKEMONTRAINER_ChicoNegro', z.player_trainer_type(:legacy, 4), 'PlayerE = metaID 4'
    assert_equal 'POKEMONTRAINER_ChicoNeutro', z.player_trainer_type(:legacy, 0)
    assert_nil z.player_trainer_type(:legacy, 99)
  end

  def test_anil_clases_ini_y_jugadores_por_seccion
    a = real_store(:anil)
    t = a.trainer_type('POKEMONTRAINER_RojoNeutro')
    assert_equal 'Entrenador', t.name
    assert_nil t.id, 'v19+ no numera las clases'
    assert_equal 'POKEMONTRAINER_RojoNeutro', a.player_trainer_type(:section, 1)
    assert_equal 'POKEMONTRAINER_HojaNeutra', a.player_trainer_type(:section, 2)
    assert_nil a.player_trainer_type(:section, 0), 'la seccion [0] es la global, no un jugador'
  end

  def test_z_sin_pbs_se_leen_los_dat_compilados
    src = File.expand_path('../test_pbs/Data_POKEMON_Z', __dir__)
    skip 'falta test_pbs/Data_POKEMON_Z' unless File.exist?(File.join(src, 'trainertypes.dat'))
    Dir.mktmpdir('peshex_dat') do |root|
      FileUtils.mkdir_p(File.join(root, 'Data'))
      %w[trainertypes.dat metadata.dat].each { |f| FileUtils.cp(File.join(src, f), File.join(root, 'Data', f)) }
      store = Sem::GameData::Store.new(root)
      assert_equal 'POKEMONTRAINER_ChicoNegro', store.trainer_type(4).internal
      assert_equal 'POKEMONTRAINER_ChicoNegro', store.player_trainer_type(:legacy, 4), 'metadata.dat: [4, "trchar004", ...]'
      assert_equal 'POKEMONTRAINER_ChicoNeutro', store.player_trainer_type(:legacy, 0)
    end
  end

  def test_parsers_aceptan_las_variantes_de_formato
    csv = "0,TRAINER_A,Uno,60\n4,TRAINER_B,\"Dos, con coma\",60\n"
    list = Sem::GameData::Pbs.trainer_types(csv)
    assert_equal [[0, 'TRAINER_A', 'Uno'], [4, 'TRAINER_B', 'Dos, con coma']], list.map { |x| [x.id, x.internal, x.name] }
    numbered = "[4]\nInternalName=TRAINER_C\nName=Tres\n"
    assert_equal [[4, 'TRAINER_C', 'Tres']], Sem::GameData::Pbs.trainer_types(numbered).map { |x| [x.id, x.internal, x.name] }
    meta = Sem::GameData::Pbs.player_metadata("[000]\nPlayerA=TA,trchar000,bike\nPlayerB=TB,trchar001\n[001]\nName=x\n")
    assert_equal %w[TA TB], meta[:legacy].map { |m| m[:trainer_type] }
    assert_equal({}, meta[:sections])
  end

  def test_z_el_save_trae_el_aspecto_del_entrenador
    h = Harness.new
    with_save_copy('Game.rxdata') do |path|
      h.open(path)
      h.call('set_game_folder', path: real_game_root(:z), source: 'manual')
      look = h.call('get_overview')['trainer']['look']
      assert_equal 'POKEMONTRAINER_ChicoNegro', look['internal']
      assert_equal 4, look['number'], 'trainer004.png'
      assert_equal 'Entrenador', look['label']
      assert_equal 0, look['outfit']
      assert_equal 4, look['playerId']
    end
  end

  def test_anil_el_save_trae_el_nombre_interno_y_el_jugador
    h = Harness.new
    with_save_copy('Partida.rxdata') do |path|
      h.open(path)
      h.call('set_game_folder', path: real_game_root(:anil), source: 'manual')
      look = h.call('get_trainer')['trainer']['look']
      assert_equal 'POKEMONTRAINER_RojoNeutro', look['internal']
      assert_nil look['number']
      assert_equal 5, look['playerId']
      assert_equal 0, look['outfit']
    end
  end

  def test_sin_carpeta_de_juego_solo_se_sabe_lo_que_dice_el_save
    h = Harness.new
    with_save_copy('Partida.rxdata') do |path|
      h.open(path)
      look = h.call('get_trainer')['trainer']['look']
      assert_equal 'POKEMONTRAINER_RojoNeutro', look['internal'], 'el save de v21 guarda el nombre'
      assert_nil look['label']
    end
  end
end
