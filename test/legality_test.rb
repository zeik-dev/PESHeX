require 'test_helper'
require_relative 'fixtures/make_game_folder'

# Reglas de legalidad, modos HeX/HaX y la guardia que rechaza ilegalidades NUEVAS.
class LegalityTest < Minitest::Test
  @@dir = nil
  @@dir_nolearn = nil

  def self.fixture_dir
    @@dir ||= Dir.mktmpdir('peshex_legal').tap do |d|
      GameFixture.build(d, from: File.join(SAVES_DIR, 'Partida_2.rxdata'))
      Minitest.after_run { FileUtils.rm_rf(d) }
    end
  end

  # Juego cuyos movimientos NO explican los del save (como un randomizer).
  def self.randomizer_dir
    @@dir_nolearn ||= Dir.mktmpdir('peshex_rand').tap do |d|
      GameFixture.build(d, from: File.join(SAVES_DIR, 'Partida_2.rxdata'), learnsets: false)
      Minitest.after_run { FileUtils.rm_rf(d) }
    end
  end

  def setup
    @h = Harness.new
    @h.open(save_path('Partida_2.rxdata'), mode: 'hex') # estas pruebas son del modo HeX (el modo por defecto es HaX)
    @original = @h.session.doc.to_bytes
  end

  def link(dir = self.class.fixture_dir)
    @h.call('set_game_folder', path: dir)
  end

  def hax(ops)
    @h.call('apply_ops', ops: ops, mode: 'hax')
  end

  def patch(ref, patch, mode: 'hax')
    @h.call('apply_ops', ops: [{ op: 'pokemon.patch', ref: ref, patch: patch }], mode: mode)
  end

  def flags_of(ref)
    @h.call('get_pokemon', ref: ref)['pokemon']['flags']
  end

  def codes(ref)
    flags_of(ref).map { |f| f['code'] }
  end

  # ── Informe y cobertura ───────────────────────────────────────────────────

  def test_el_save_original_con_su_juego_no_tiene_ilegalidades
    link
    r = @h.call('check_legality')
    assert_equal 'hex', r['mode']
    assert_equal 'full', r['coverage']['level']
    assert_equal 0, r['summary']['illegal'], r['flags'].inspect
    assert_includes r['coverage']['evaluated'], 'move_not_learnable'
    assert_includes r['coverage']['evaluated'], 'ability_not_allowed'
  end

  def test_sin_carpeta_solo_se_aplican_reglas_basicas_y_se_explica_que_se_omite
    r = @h.call('check_legality')
    assert_equal 'basic', r['coverage']['level']
    skipped = r['coverage']['skipped'].to_h { |s| [s['code'], s['reason']] }
    assert_equal 'no_game_folder', skipped['move_not_learnable']
    assert_equal 'no_game_folder', skipped['species_unknown']
    assert_equal 'no_game_folder', skipped['item_unknown']
    assert_includes r['coverage']['evaluated'], 'level_range'
    assert_includes r['coverage']['evaluated'], 'moves_duplicate'
    assert_equal 0, r['summary']['illegal'], 'el save original es "legal" para las reglas basicas'
  end

  def test_los_largos_de_nombre_solo_se_comprueban_si_los_scripts_los_definen
    link
    skipped = @h.call('check_legality')['coverage']['skipped'].to_h { |s| [s['code'], s['reason']] }
    assert_equal 'limit_not_found', skipped['nickname_too_long']
    assert_equal 'limit_not_found', skipped['trainer_name']
  end

  def test_carpeta_de_otro_juego_degrada_a_basica_sin_falsos_positivos
    Dir.mktmpdir('peshex_otro') do |dir|
      GameFixture.build(dir, from: save_path('Partida.rxdata'))
      @h.call('set_game_folder', path: dir)
      r = @h.call('check_legality')
      assert_equal 'basic', r['coverage']['level']
      assert_equal 0, r['summary']['illegal'], r['flags'].inspect
      assert_includes r['coverage']['skipped'].map { |s| s['reason'] }, 'species_mismatch'
    end
  end

  def test_si_los_movimientos_no_cuadran_con_el_juego_no_se_comprueban_pero_lo_demas_si
    link(self.class.randomizer_dir)
    r = @h.call('check_legality')
    assert_equal 'partial', r['coverage']['level']
    assert_includes r['coverage']['reasons'], 'moves_untrusted'
    assert_equal 'moves_untrusted', r['coverage']['skipped'].find { |s| s['code'] == 'move_not_learnable' }['reason']
    assert_includes r['coverage']['evaluated'], 'ability_not_allowed'
    assert_equal 0, r['summary']['illegal'], r['flags'].inspect
  end

  # ── Cada regla, provocada en HaX ──────────────────────────────────────────

  def test_reglas_de_pokemon_se_disparan
    link
    cases = {
      'species_unknown' => { species: 'FAKEMON' },
      'level_range' => { level: 150 },
      'exp_negative' => { exp: -5 },
      'exp_level_mismatch' => { exp: 1 },
      'nature_invalid' => { nature: 'WEIRD' },
      'gender_invalid' => { gender: 7 },
      'gender_forbidden' => { gender: 2 },
      'ability_not_allowed' => { ability: 'STENCH' },
      'iv_range' => { iv: { HP: 99 } },
      'ev_range' => { ev: { HP: 300 } },
      'ev_total' => { ev: { HP: 252, ATTACK: 252, DEFENSE: 252 } },
      'happiness_range' => { happiness: 999 },
      'hp_over_total' => { hp: 9999 },
      'item_unknown' => { item: 'NOEXISTE' },
      'ball_unknown' => { ball: 'NOEXISTE' },
      'nickname_too_long' => { nickname: 'X' * 40 },
      'move_unknown' => { moves: [{ slot: 0, id: 'NOSUCHMOVE' }] },
      'move_not_learnable' => { moves: [{ slot: 0, id: GameFixture::UNLEARNABLE_MOVE }] },
      'pp_over_total' => { moves: [{ slot: 0, pp: 99 }] },
      'ppups_range' => { moves: [{ slot: 0, ppUps: 7 }] },
      'stats_mismatch' => { level: 80, exp: 0 }
    }
    cases.each do |code, p|
      @h.call('undo_all')
      @h.call('set_game_folder', path: self.class.fixture_dir) if @h.session.game.nil?
      r = patch('party/0', p)
      assert r['applied'], "#{code}: #{r.inspect}"
      if code == 'nickname_too_long'
        # sin el limite en los scripts esta regla se omite: no debe disparar
        refute_includes codes('party/0'), code
        next
      end
      assert_includes codes('party/0'), code, "#{code} deberia dispararse"
    end
  end

  def test_nickname_too_long_con_limite_de_scripts
    link
    r = patch('party/0', { nickname: 'ABCDEFGHIJKLMNOPQ' })
    assert r['applied']
    refute_includes codes('party/0'), 'nickname_too_long', 'el fixture no define MAX_NAME_SIZE'
  end

  def test_movimientos_duplicados_y_cantidad
    link
    patch('party/0', { moves: [{ slot: 1, id: @h.call('get_pokemon', ref: 'party/0')['pokemon']['moves'][0]['id'] }] })
    assert_includes codes('party/0'), 'moves_duplicate'
  end

  def test_estado_desconocido_es_solo_advertencia
    link
    patch('party/0', { status: 'FROSTBITE2' })
    f = flags_of('party/0').find { |x| x['code'] == 'status_invalid' }
    assert_equal 'warning', f['severity']
  end

  def test_reglas_de_mochila_y_entrenador
    link
    hax([{ op: 'bag.set', pocket: 1, id: 'NOEXISTE', qty: 3 }, { op: 'bag.set', pocket: 3, id: 'POTION', qty: 2 },
         { op: 'bag.set', pocket: 1, id: 'RARECANDY', qty: 5000 }])
    bag = @h.call('check_legality')['flags']['bag'].map { |f| [f['code'], f['subject']] }
    assert_includes bag, ['bag_item_unknown', 'NOEXISTE']
    assert_includes bag, ['bag_wrong_pocket', 'POTION']
    assert_includes bag, ['bag_qty_range', 'RARECANDY']

    hax([{ op: 'set', ref: 'trainer', field: 'money', value: 5_000_000 }, { op: 'set', ref: 'trainer', field: 'coins', value: -1 }])
    tr = @h.call('check_legality')['flags']['trainer'].map { |f| f['code'] }
    assert_includes tr, 'trainer_money'
    assert_includes tr, 'trainer_coins'
  end

  def test_el_equipo_solo_de_huevos_es_advertencia
    link
    6.times { |i| patch("party/#{i}", {}) } # sin cambios: no rompe
    refute_includes @h.call('check_legality')['flags'].fetch('party', []).map { |f| f['code'] }, 'egg_only_party'
  end

  # ── Guardia de HeX ────────────────────────────────────────────────────────

  def test_hex_rechaza_cada_ilegalidad_nueva_y_no_deja_nada
    link
    [{ species: 'FAKEMON' }, { level: 150 }, { iv: { HP: 99 } }, { item: 'NOEXISTE' },
     { moves: [{ slot: 0, id: GameFixture::UNLEARNABLE_MOVE }] }, { ability: 'STENCH' }].each do |p|
      r = patch('party/0', p, mode: 'hex')
      refute r['applied'], p.inspect
      assert_equal 'illegal', r.dig('rejected', 'code')
      refute_empty r.dig('rejected', 'flags')
      assert_equal @original, @h.session.doc.to_bytes, "#{p.inspect} no debe dejar nada"
    end
    refute @h.session.dirty?
  end

  def test_hex_permite_cambios_legales
    link
    r = patch('party/0', { nickname: 'Rayo', happiness: 100, iv: { HP: 31 } }, mode: 'hex')
    assert r['applied'], r.inspect
    assert_empty r['newFlags']
  end

  def test_una_ilegalidad_que_el_save_ya_tenia_no_bloquea_ediciones_ajenas
    link
    patch('party/0', { level: 150 }, mode: 'hax') # ya ilegal
    r = patch('party/0', { nickname: 'Rayo' }, mode: 'hex') # edicion ajena y legal
    assert r['applied'], r.inspect
    # ...pero introducir OTRA ilegalidad en el mismo Pokemon si se rechaza
    r2 = patch('party/0', { iv: { HP: 99 } }, mode: 'hex')
    refute r2['applied']
    assert_equal ['iv_range'], r2.dig('rejected', 'flags').map { |f| f['code'] }
  end

  def test_mover_entre_equipo_y_pc_no_cuenta_como_ilegalidad_nueva
    link
    patch('party/2', { level: 150 }, mode: 'hax')
    dst = @h.call('list_boxes')['storage']['boxes'].flat_map { |b| b['slots'].each_with_index.filter_map { |s, i| s.nil? ? "box/#{b['index']}/#{i}" : nil } }.first
    r = @h.call('apply_ops', ops: [{ op: 'pokemon.move', from: 'party/2', to: dst }], mode: 'hex')
    assert r['applied'], r.inspect
    r = @h.call('apply_ops', ops: [{ op: 'pokemon.move', from: dst, to: 'party/5' }], mode: 'hex')
    assert r['applied'], r.inspect
  end

  def test_hax_aplica_y_avisa_de_las_flags_nuevas
    link
    r = patch('party/0', { level: 150, iv: { HP: 99 } }, mode: 'hax')
    assert r['applied']
    assert_equal %w[iv_range level_range], r['newFlags'].select { |f| f['severity'] == 'illegal' }.map { |f| f['code'] }.sort
    assert_equal 'warning', r['newFlags'].find { |f| f['code'] == 'stats_mismatch' }['severity'], 'cambiar el nivel desajusta los stats guardados'
    assert_equal ['party/0'], r['newFlags'].map { |f| f['ref'] }.uniq
  end

  def test_preview_informa_sin_aplicar
    link
    r = @h.call('preview_ops', ops: [{ op: 'pokemon.patch', ref: 'party/0', patch: { level: 150 } }])
    assert r['blocking']
    assert_equal ['level_range'], r['newFlags'].select { |f| f['severity'] == 'illegal' }.map { |f| f['code'] }
    assert_equal @original, @h.session.doc.to_bytes
    r = @h.call('preview_ops', ops: [{ op: 'pokemon.patch', ref: 'party/0', patch: { level: 150 } }], mode: 'hax')
    refute r['blocking']
  end

  def test_deshacer_quita_las_flags
    link
    patch('party/0', { level: 150 }, mode: 'hax')
    assert_includes codes('party/0'), 'level_range'
    @h.call('undo')
    refute_includes codes('party/0'), 'level_range'
    assert_equal @original, @h.session.doc.to_bytes
  end

  # ── Edicion cruda (Avanzado) ──────────────────────────────────────────────

  def raw_set(path, input, mode)
    @h.session.mode = mode
    idx = @h.call('locate_field', path: path)['index']
    @h.call('set_field', index: idx, input: input)
  end

  def test_la_edicion_cruda_tambien_pasa_por_la_guardia
    link
    r = raw_set('.player@money', 'int:99999999', 'hex')
    refute r['applied']
    assert_equal 'trainer_money', r.dig('rejected', 'flags').first['code']
    assert_equal @original, @h.session.doc.to_bytes

    r = raw_set('.player@party[0]@level', 'int:500', 'hex')
    refute r['applied']
    assert_equal 'level_range', r.dig('rejected', 'flags').first['code']

    r = raw_set('.player@money', 'int:99999999', 'hax')
    assert r['applied']
    assert_equal ['trainer_money'], r['newFlags'].map { |f| f['code'] }
  end

  def test_la_edicion_cruda_de_datos_del_mundo_no_se_bloquea
    link
    r = raw_set('.player@id', 'int:5', 'hex')
    assert r['applied'], r.inspect
  end

  # ── Cache e informes ──────────────────────────────────────────────────────

  def test_el_informe_se_cachea_por_revision_y_cambia_al_editar
    link
    a = @h.call('check_legality')
    b = @h.call('check_legality')
    assert_equal a['summary'], b['summary']
    patch('party/0', { level: 150 }, mode: 'hax')
    c = @h.call('check_legality')
    assert_equal 1, c['summary']['illegal']
    assert_equal ['party/0'], c['flags'].keys
  end

  def test_check_legality_con_refs_y_con_info
    link
    patch('party/0', { level: 150 }, mode: 'hax')
    only = @h.call('check_legality', refs: ['party/1'])
    assert_empty only['flags']
    full = @h.call('check_legality', includeInfo: true)
    assert full['summary'].key?('info')
  end

  def test_rendimiento_con_el_save_grande
    with_save_copy('Partida.rxdata') do |path|
      h = Harness.new
      h.open(path)
      Dir.mktmpdir('peshex_big') do |dir|
        GameFixture.build(dir, from: path)
        h.call('set_game_folder', path: dir)
        t = Time.now
        r = h.call('check_legality')
        assert_operator Time.now - t, :<, 3.0, 'check_legality en frio'
        assert_operator r['summary']['checked'], :>, 200
        assert_equal 0, r['summary']['illegal'], r['flags'].first(3).inspect
        t = Time.now
        h.call('check_legality')
        assert_operator Time.now - t, :<, 0.3, 'check_legality cacheado'
      end
    end
  end
end
