require 'test_helper'
require_relative 'fixtures/real_games'

# Saves REALES (test_saves/) con los juegos REALES (test_pbs/): Pokémon Z (Essentials v16-18, ids enteros,
# nivel/habilidad/naturaleza/bola derivados) y Pokémon Añil (v21, naturaleza cambiada con menta).
class RealSavesTest < Minitest::Test
  include RealGames

  def setup
    @h = Harness.new
  end

  def open_z
    with_save_copy('Game.rxdata') do |path|
      @h.open(path)
      @h.call('set_game_folder', path: real_game_root(:z), source: 'manual')
      @original = @h.session.doc.to_bytes
      yield
    end
  end

  def pokemon(ref)
    @h.call('get_pokemon', ref: ref)['pokemon']
  end

  def apply(ops, mode: 'hax')
    @h.call('apply_ops', { ops: ops, mode: mode })
  end

  # ── Pokémon Z (v16-18) ───────────────────────────────────────────────────
  def test_z_la_calibracion_confirma_el_pbs_con_el_save
    open_z do
      cal = @h.session.game_calibration
      assert_equal 'ok', cal[:species][:status]
      assert_equal 'ok', cal[:exp][:status]
      assert_equal 'ok', cal[:moves][:status], 'los ids de movimiento enteros se resuelven por numero'
      assert_equal 'ok', cal[:abilities][:status], 'la habilidad se deriva del indice @abilityflag'
      assert_equal 'ok', cal[:stats][:status]
    end
  end

  def test_z_nivel_habilidad_naturaleza_y_bola_se_derivan
    open_z do
      d = pokemon('party/0')
      assert_equal [59, 'Arcanine'], [d['species']['id'], d['species']['name']]
      assert_equal 65, d['level'], 'sin @level: sale de la experiencia'
      assert_equal 'INTIMIDATE', d.dig('ability', 'id')
      assert_equal 'ADAMANT', d.dig('nature', 'id')
      assert_equal 'GREATBALL', d.dig('ballItem', 'id'), '@ballused=1 es el indice de $BallTypes, no el objeto 1'
      assert_equal false, d.dig('capabilities', 'natureForStats')
      assert_equal 1, @h.call('list_party')['party'].first['gender']
    end
  end

  def test_z_las_bolas_caseras_salen_de_la_tabla_de_scripts
    open_z do
      model = Sem::Api.state!(@h.session).model
      node = model.scan.pokemon.map(&:node).find { |pk| Sem::Tree.int_value(Sem::Tree.ivar(pk, '@ballused')) == 25 }
      assert node, 'Game.rxdata tiene Pokémon con @ballused=25'
      assert_equal 'POKEBALLCASERA', model.pokemon_summary(node, 'x').dig(:ballItem, :id)
    end
  end

  def test_z_editar_por_nombre_escribe_numeros_y_se_deshace
    open_z do
      r = apply([{ op: 'pokemon.patch', ref: 'party/0',
                   patch: { item: 'POTION', nature: 'TIMID', ball: 'ULTRABALL', ability: 'FLASHFIRE', level: 70,
                            moves: [{ slot: 0, id: 'THUNDERBOLT' }] } }])
      assert r['applied'], r.inspect
      d = pokemon('party/0')
      assert_equal [217, 'TIMID', 'ULTRABALL', 'FLASHFIRE'], [d.dig('item', 'id'), d.dig('nature', 'id'), d.dig('ballItem', 'id'), d.dig('ability', 'id')]
      assert_equal 'Poción', d.dig('item', 'name'), 'el id entero 217 se nombra con el PBS'
      assert_equal 70, d['level']
      assert_equal 1, d['abilityIndex']
      move = d['moves'].first
      assert_equal Sem::Api.state!(@h.session).model.game.move('THUNDERBOLT').number, move['id']
      assert_equal 'Rayo', move['name']
      @h.call('undo')
      assert_equal @original, @h.session.doc.to_bytes
    end
  end

  def test_z_una_habilidad_que_la_especie_no_tiene_se_rechaza_con_un_error_claro
    open_z do
      err = assert_raises(DriverError) { apply([{ op: 'pokemon.patch', ref: 'party/0', patch: { ability: 'WONDERGUARD' } }]) }
      assert_equal 'ability_not_in_species', err.params[:code]
      assert_equal @original, @h.session.doc.to_bytes
    end
  end

  def test_z_agregar_un_pokemon_por_nombre_en_el_pc
    open_z do
      before = @h.call('list_boxes')['storage']['total']
      r = apply([{ op: 'pokemon.add', to: 'auto', data: { species: 'PIKACHU', level: 20, moves: [{ id: 'THUNDERBOLT' }] } }])
      assert r['applied'], r.inspect
      assert_equal before + 1, @h.call('list_boxes')['storage']['total']
      slots = @h.call('list_boxes')['storage']['boxes'].flat_map { |b| b['slots'].compact }
      pikachu = slots.find { |s| s.dig('species', 'id') == 25 && s['level'] == 20 }
      assert pikachu, 'el Pikachu nuevo existe con id entero 25 y nivel 20 derivado de la experiencia'
      assert_equal 'Pikachu', pikachu.dig('species', 'name')
      @h.call('undo')
      assert_equal @original, @h.session.doc.to_bytes
    end
  end

  def test_z_las_formas_que_define_un_script_no_se_marcan_como_inexistentes
    open_z do
      d = pokemon('party/0') # Arcanine con @form = 1 (forma del propio juego, definida en sus scripts)
      assert_equal 1, d['form']
      codes = d['flags'].map { |f| f['code'] }
      refute_includes codes, 'form_unknown', 'el PBS de v16-18 no lista las formas: no se puede afirmar que no existan'
      refute_includes codes, 'stats_mismatch', 'los stats base de esa forma no estan en el PBS: no se compara'
    end
  end

  def test_z_un_slot_de_movimiento_vacio_no_es_un_falso_positivo
    open_z do
      # En v16-18 el hueco libre es un PBMove con id 0: no es un movimiento y le puede pasar a cualquier Pokémon.
      r = apply([{ op: 'pokemon.patch', ref: 'party/0', patch: { moves: [{ slot: 2, id: 0 }, { slot: 3, id: 0 }] } }])
      assert r['applied'], r.inspect
      assert_equal [], r['newFlags'], r['newFlags'].inspect
      d = pokemon('party/0')
      codes = d['flags'].map { |f| f['code'] }
      refute_includes codes, 'move_unknown'
      refute_includes codes, 'moves_duplicate'
      assert_equal [true, true], d['moves'].values_at(2, 3).map { |m| m['empty'] }
      assert_equal 'ok', @h.session.game_calibration[:moves][:status], 'los huecos no estropean la calibracion'
    end
  end

  # ── Pokémon Añil (v21) ───────────────────────────────────────────────────
  def open_anil
    with_save_copy('Partida.rxdata') do |path|
      @h.open(path)
      @h.call('set_game_folder', path: real_game_root(:anil), source: 'manual')
      @original = @h.session.doc.to_bytes
      yield
    end
  end

  def test_anil_naturaleza_por_menta_se_lee_se_edita_y_cuenta_para_los_stats
    open_anil do
      d = pokemon('party/0')
      assert_equal 'MODEST', d.dig('nature', 'id'), 'la naturaleza original no cambia'
      assert_equal 'SERIOUS', d.dig('natureForStats', 'id')
      assert_equal true, d.dig('capabilities', 'natureForStats')

      r = apply([{ op: 'pokemon.patch', ref: 'party/0', patch: { natureForStats: 'ADAMANT' } }])
      assert r['applied'], r.inspect
      d = pokemon('party/0')
      assert_equal %w[MODEST ADAMANT], [d.dig('nature', 'id'), d.dig('natureForStats', 'id')]
      assert_equal 'ADAMANT', Sem::Api.model(@h.ctx).then { |m| Sem::PokeFacts.read(m.resolve_pokemon('party/0')[:node]).nature_for_stats }

      r = apply([{ op: 'pokemon.patch', ref: 'party/0', patch: { natureForStats: nil } }])
      assert r['applied'], r.inspect
      assert_nil pokemon('party/0')['natureForStats']
      @h.call('undo_all')
      assert_equal @original, @h.session.doc.to_bytes
    end
  end

  def test_anil_una_forma_inexistente_si_se_avisa
    open_anil do
      assert_equal false, Sem::Api.model(@h.ctx).then { |m| @h.session.game.forms_scripted? }
      r = apply([{ op: 'pokemon.patch', ref: 'party/0', patch: { species: 'VENUSAUR', form: 99 } }])
      assert r['applied'], r.inspect
      assert_includes pokemon('party/0')['flags'].map { |f| f['code'] }, 'form_unknown'
    end
  end

  def form_flags_for(species, form)
    r = apply([{ op: 'pokemon.patch', ref: 'party/0', patch: { species: species, form: form } }])
    assert r['applied'], r.inspect
    pokemon('party/0')['flags'].map { |f| f['code'] }
  end

  def test_anil_las_formas_por_defecto_y_cosmeticas_no_son_falsos_positivos
    open_anil do
      # MR. RIME no tiene entrada [MRRIME,1]: la forma 1 viene de `Flags = DefaultForm_1` (evolucion de MR. MIME de Galar).
      refute_includes form_flags_for('MRRIME', 1), 'form_unknown'
      # MINIOR define las formas 7-13; las 1-6 son colores del meteorito (sin entrada propia).
      refute_includes form_flags_for('MINIOR', 5), 'form_unknown'
      # LECHONK no declara ninguna forma: la forma 1 la fija el juego, no el PBS.
      refute_includes form_flags_for('LECHONK', 1), 'form_unknown'
      # Pero una forma que de verdad no existe sigue avisando.
      assert_includes form_flags_for('MINIOR', 99), 'form_unknown'
      assert_includes form_flags_for('PIKACHU', 99), 'form_unknown'
    end
  end

  def test_anil_form_exists_en_el_almacen
    store = real_store(:anil)
    assert store.form_exists?('MRRIME', 1)
    assert store.form_exists?('MRRIME', 0)
    assert store.form_exists?('ARCANINE', 1), 'forma regional definida en pokemon_forms.txt'
    refute store.form_exists?('VENUSAUR', 99)
  end

  def test_anil_arcanine_de_hisui_aprende_testarazo_por_su_preevolucion
    store = real_store(:anil)
    assert store.move_learnable?('ARCANINE', 1, 100, 'HEADSMASH'), 'movimiento huevo de GROWLITHE de Hisui'
    assert_includes store.prevos('SNEASLER'), 'SNEASEL', 'la evolucion existe solo desde una forma'
    assert_includes store.prevos('OBSTAGOON'), 'LINOONE'
    refute store.move_learnable?('ARCANINE', 1, 100, 'SPLASH'), 'lo que no aprende nadie de la linea sigue siendo ilegal'
    open_anil do
      r = apply([{ op: 'pokemon.patch', ref: 'party/0', patch: { species: 'ARCANINE', form: 1, level: 100,
                                                                 moves: [{ slot: 0, id: 'HEADSMASH' }] } }])
      assert r['applied'], r.inspect
      # Los otros tres movimientos son del INCINEROAR original y sí se marcan; Testarazo ya no.
      subjects = pokemon('party/0')['flags'].select { |f| f['code'] == 'move_not_learnable' }.map { |f| f['subject'] }
      refute_includes subjects, 'HEADSMASH'
      assert_includes subjects, 'PARTINGSHOT'
    end
  end

  def test_anil_las_cintas_se_leen_como_lista_y_el_pbs_las_nombra
    open_anil do
      d = pokemon('party/0')
      assert_equal [], d['ribbons'], 'el save trae @ribbons vacio'
      # Con una cinta en el save, el PBS (ribbons.txt) le pone nombre.
      pk = Sem::Api.model(@h.ctx).resolve_pokemon('party/0')[:node]
      Sem::Tree.ivar(pk, '@ribbons').items << Sem::RX::RxSym.new('HOENNCOOL')
      dto = Sem::Api.model(@h.ctx).pokemon_detail('party/0')
      assert_equal [{ id: 'HOENNCOOL', name: 'Cinta Carisma' }], dto[:ribbons]
    end
  end

  def test_anil_exporta_e_importa_la_naturaleza_por_menta
    open_anil do
      exp = @h.call('export_pokemon', ref: 'party/0')
      data = exp['data'] || exp['json'] || exp['pokemon']
      assert_equal 'SERIOUS', data['natureForStats']
    end
  end
end

# La mochila de Pokémon Z guarda los objetos como números: se agregan y se encuentran por su id interno.
class RealBagTest < Minitest::Test
  include RealGames

  def test_z_agregar_un_objeto_por_nombre_no_duplica_el_existente
    h = Harness.new
    with_save_copy('Game.rxdata') do |path|
      h.open(path)
      h.call('set_game_folder', path: real_game_root(:z), source: 'manual')
      original = h.session.doc.to_bytes
      bag = h.call('get_bag')['bag']
      pocket = bag['pockets'].find { |p| p['slots'].any? }
      slot = pocket['slots'].first
      assert_kind_of Integer, slot['id'], 'Z guarda ids de objeto enteros'
      internal = Sem::Api.state!(h.session).model.game.item(slot['id']).id

      before = pocket['slots'].size
      r = h.call('apply_ops', { ops: [{ op: 'bag.set', pocket: pocket['index'], id: internal, qty: slot['qty'] + 5 }], mode: 'hax' })
      assert r['applied'], r.inspect
      after = h.call('get_bag')['bag']['pockets'].find { |p| p['index'] == pocket['index'] }
      assert_equal before, after['slots'].size, 'el objeto existente se actualiza, no se duplica'
      assert_equal slot['qty'] + 5, after['slots'].find { |s| s['id'] == slot['id'] }['qty']

      new_item = Sem::Api.state!(h.session).model.game.item('MASTERBALL')
      h.call('apply_ops', { ops: [{ op: 'bag.set', pocket: new_item.pocket, id: 'MASTERBALL', qty: 3 }], mode: 'hax' })
      pockets = h.call('get_bag')['bag']['pockets']
      added = pockets.flat_map { |p| p['slots'] }.find { |s| s['id'] == new_item.number }
      assert added, 'MASTERBALL se agrego como numero entero'
      assert_equal 3, added['qty']
      assert_equal 'Master Ball', added['name']

      h.call('undo_all')
      assert_equal original, h.session.doc.to_bytes
    end
  end
end
