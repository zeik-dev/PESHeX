# =============================================================================
# model.rb — Vistas semanticas (DTOs JSON) del save: entrenador, equipo, PC,
# bolsa y Pokemon. Lee directamente el arbol de nodos; todo lo que no mapea a
# un control propio se devuelve en `extras` (nunca se descarta).
#
# Referencias estables (`ref`): trainer · party/N · box/B/S · bag/P/S
# =============================================================================

module Sem
  class Model
    POCKET_KEYS = %w[items medicine pokeballs tmhm berries mail battle key].freeze

    attr_reader :resolved, :scan, :doc
    # Datos del juego vinculado (Sem::GameData::Store) y su calibracion contra este save.
    attr_accessor :game, :calibration

    def initialize(resolved)
      @resolved = resolved
      @scan = resolved.scan
      @doc = resolved.doc
      @claims = nil
    end

    def binding(role)
      @resolved.binding(role)
    end

    def limits
      base = @resolved.profile.limits
      @game ? base.merge(@game.limit_overrides) : base
    end

    # ── Nombres ───────────────────────────────────────────────────────────────

    def name_of(kind, id)
      return nil if id.nil?

      @game&.name_of(kind, id) || @scan.names[kind][id.to_s] || Ids.pretty(id)
    end

    def id_dto(kind, node)
      id = Ids.of(node)
      return nil if id.nil? || id == ''
      return nil if id.is_a?(Integer) && id.zero? && kind == :item

      { id: id, name: name_of(kind, id) }
    end

    # ── Entrenador ────────────────────────────────────────────────────────────

    # Donde vive cada campo del entrenador: lista ordenada de [rol, ivars].
    TRAINER_FIELD_SPECS = {
      'name' => [[:trainer, %w[@name]]],
      'id' => [[:trainer, %w[@id @publicID]]],
      'trainer_type' => [[:trainer, %w[@trainer_type @trainertype]]],
      'gender' => [[:trainer, %w[@gender]]],
      'language' => [[:trainer, %w[@language]]],
      'money' => [[:trainer, %w[@money]]],
      'coins' => [[:trainer, %w[@coins]], [:global, %w[@coins]]],
      'battle_points' => [[:trainer, %w[@battle_points @battlePoints]], [:global, %w[@battlePoints @battle_points @bp]]],
      'soot' => [[:trainer, %w[@soot]], [:global, %w[@soot]]]
    }.freeze

    # Slot editable de un campo del entrenador, o nil si esta base no lo tiene.
    def trainer_slot(field)
      TRAINER_FIELD_SPECS.fetch(field, []).each do |role, ivars|
        b = binding(role)
        next unless b

        ivars.each do |iv|
          slot = Slot.of_ivar(b.node, iv, b.path)
          return slot if slot
        end
      end
      nil
    end

    def trainer_value(field)
      trainer_slot(field)&.get
    end

    def trainer_view
      b = binding(:trainer)
      return nil unless b

      obj = b.node
      type = trainer_value('trainer_type')
      {
        ref: 'trainer', fieldPath: b.path, class: b.class_name,
        name: Tree.text(trainer_value('name')),
        id: Tree.int_value(trainer_value('id')),
        trainerType: type && Ids.of(type),
        gender: Tree.int_value(trainer_value('gender')),
        language: Tree.int_value(trainer_value('language')),
        money: Tree.int_value(trainer_value('money')),
        coins: Tree.int_value(trainer_value('coins')),
        battlePoints: Tree.int_value(trainer_value('battle_points')),
        soot: Tree.int_value(trainer_value('soot')),
        available: TRAINER_FIELD_SPECS.keys.select { |f| trainer_slot(f) },
        badges: badges,
        playTime: play_time,
        lastSaved: last_saved,
        extras: extras_for(obj, Vanilla::TRAINER_DISPLAYED, Vanilla::TRAINER_OTHER, b.path),
        limits: limits
      }
    end

    def badges
      b = binding(:trainer)
      arr = b && Tree.ivar(b.node, '@badges')
      Tree.array?(arr) ? arr.items.map { |x| x == true } : []
    end

    def play_time
      st = binding(:stats)&.node
      pt = st && Tree.ivar(st, '@play_time')
      return pt.value.to_f.round(2) if pt.is_a?(RX::RxFloat)
      return pt if pt.is_a?(Integer)

      # Essentials <= v18: el segundo root es Graphics.frame_count (40 fps).
      if @resolved.facts.root_form == :multi_root && @doc.roots[1].is_a?(Integer)
        return (@doc.roots[1] / 40.0).round(2)
      end
      nil
    end

    def last_saved
      b = binding(:trainer)
      t = b && (Tree.ivar(b.node, '@last_time_saved') || Tree.ivar(b.node, '@lastSave'))
      return nil unless t.is_a?(RX::RxUDef) && t.class_name == 'Time'

      Time.send(:_load, t.bytes).utc.iso8601
    rescue StandardError
      nil
    end

    def pokedex_counts
      d = binding(:pokedex)&.node
      return nil unless d

      iv = Dex.ivars(d)
      count = lambda do |name|
        v = name && Tree.ivar(d, name)
        if Tree.hash?(v) then v.pairs.count { |_, x| x == true }
        elsif Tree.array?(v) then v.items.count { |x| x == true }
        end
      end
      { seen: count.call(iv[:seen]), owned: count.call(iv[:owned]) }
    end

    # ── Equipo y PC ───────────────────────────────────────────────────────────

    def party_binding
      binding(:trainer)
    end

    def party_items
      b = party_binding
      b ? b.array.items : []
    end

    def party_path(index)
      b = party_binding
      "#{b.path}#{Path.attr(b.ivar)}#{Path.index(index)}"
    end

    def party_summaries
      party_items.each_with_index.filter_map do |pk, i|
        pokemon_summary(pk, "party/#{i}") if pk
      end
    end

    # [[box_obj, slots_ivar, slots_array], ...] de todo el PC.
    def box_arrays
      b = binding(:storage)
      return [] unless b

      b.array.items.map do |box|
        ivar, arr = Shapes.box_like(box)
        [box, ivar, arr]
      end
    end

    def box_path(box_index, slot_index = nil)
      b = binding(:storage)
      _, ivar, = box_arrays[box_index]
      base = "#{b.path}#{Path.attr(b.ivar)}#{Path.index(box_index)}"
      slot_index.nil? ? base : "#{base}#{Path.attr(ivar)}#{Path.index(slot_index)}"
    end

    def boxes_view
      b = binding(:storage)
      return nil unless b

      current = Tree.int_value(Tree.ivar(b.node, '@currentBox'))
      boxes = box_arrays.each_with_index.map do |(box, _ivar, arr), bi|
        slots = arr ? arr.items.each_with_index.map { |pk, si| pk && pokemon_summary(pk, "box/#{bi}/#{si}") } : []
        { index: bi, name: Tree.text(Tree.ivar(box, '@name')), slots: slots,
          filled: slots.count { |s| !s.nil? }, fieldPath: box_path(bi),
          background: Tree.int_value(Tree.ivar(box, '@background')) }
      end
      { ref: 'storage', fieldPath: b.path, currentBox: current, boxes: boxes,
        total: boxes.sum { |x| x[:filled] },
        extras: extras_for(b.node, Vanilla::STORAGE_DISPLAYED, Vanilla::STORAGE_OTHER, b.path) }
    end

    # Resuelve un `ref` de Pokemon -> { node:, path:, parent_array:, index: } o nil.
    def resolve_pokemon(ref)
      kind, *rest = ref.to_s.split('/')
      case kind
      when 'party'
        i = rest[0].to_i
        pk = party_items[i]
        pk && { node: pk, path: party_path(i), array: party_binding.array, index: i }
      when 'box'
        bi = rest[0].to_i
        si = rest[1].to_i
        _, _, arr = box_arrays[bi]
        pk = arr && arr.items[si]
        pk && { node: pk, path: box_path(bi, si), array: arr, index: si }
      end
    end

    # ── Pokemon ───────────────────────────────────────────────────────────────

    def egg?(pk)
      steps = Tree.int_value(first_value(pk, %w[@steps_to_hatch @eggsteps]))
      !steps.nil? && steps.positive?
    end

    def first_value(obj, names)
      Tree.first_ivar(obj, names)&.last&.last
    end

    def pokemon_summary(pk, ref)
      species = first_value(pk, %w[@species])
      legacy = Derived.legacy?(pk)
      {
        ref: ref, species: id_dto(:species, species), form: Tree.int_value(first_value(pk, %w[@form])),
        nickname: Tree.text(first_value(pk, %w[@name @nickname])),
        level: Tree.int_value(first_value(pk, %w[@level])) || Derived.level(@game, pk),
        gender: Tree.int_value(first_value(pk, %w[@gender @genderflag])) || (legacy ? Derived.gender(@game, pk) : nil),
        shiny: first_value(pk, %w[@shiny @shinyflag]) == true,
        egg: egg?(pk),
        hp: Tree.int_value(first_value(pk, %w[@hp])), totalHp: Tree.int_value(first_value(pk, %w[@totalhp])),
        item: id_dto(:item, first_value(pk, %w[@item])),
        status: Ids.of(first_value(pk, %w[@status])),
        ball: Ids.of(first_value(pk, %w[@poke_ball @ballused])), ballItem: ball_dto(pk)
      }
    end

    # Bola como objeto del juego: v19+ ya guarda el id del objeto; v16-18 guarda un indice de $BallTypes.
    def ball_dto(pk)
      raw = Ids.of(first_value(pk, %w[@poke_ball @ballused]))
      return nil if raw.nil? || raw == ''

      item = Derived.ball_item(@game, raw)
      item ? { id: item, name: name_of(:item, item) } : nil
    end

    def move_dtos(pk)
      arr = Tree.ivar(pk, '@moves')
      return [] unless Tree.array?(arr)

      arr.items.each_with_index.filter_map do |m, i|
        next nil unless m

        id_node = Tree.object?(m) ? Tree.ivar(m, '@id') : m
        mid = Ids.of(id_node)
        # Hueco libre de las bases <= v18 (PBMove con id 0): la UI lo trata como un slot vacio.
        next({ slot: i, id: nil, name: nil, empty: true, pp: nil, ppUps: nil }) if mid == 0 || mid == ''

        {
          slot: i, id: mid, name: name_of(:move, mid),
          pp: Tree.int_value(Tree.object?(m) ? Tree.ivar(m, '@pp') : nil),
          ppUps: Tree.int_value(Tree.object?(m) ? first_value(m, %w[@ppup @ppUp]) : nil)
        }
      end
    end

    def owner_dto(pk)
      o = first_value(pk, %w[@owner])
      if Tree.object?(o)
        { name: Tree.text(Tree.ivar(o, '@name')), id: Tree.int_value(Tree.ivar(o, '@id')),
          gender: Tree.int_value(Tree.ivar(o, '@gender')) }
      else
        ot = Tree.text(first_value(pk, %w[@ot]))
        ot && { name: ot, id: Tree.int_value(first_value(pk, %w[@trainerID])), gender: nil }
      end
    end

    # Cintas (v19+: simbolos en @ribbons; ribbons.txt las nombra). nil si el Pokemon no tiene ese campo.
    def ribbon_dtos(pk)
      arr = Tree.ivar(pk, '@ribbons')
      return nil unless Tree.array?(arr)

      arr.items.filter_map do |r|
        id = Ids.of(r)
        id.nil? || id == '' ? nil : { id: id, name: name_of(:ribbon, id) }
      end
    end

    # Detalle completo de un Pokemon.
    def pokemon_detail(ref)
      found = resolve_pokemon(ref)
      return nil unless found

      pk = found[:node]
      path = found[:path]
      iv = Tree.ivar(pk, '@iv')
      ev = Tree.ivar(pk, '@ev')
      evs = StatMap.read(ev)
      cached = {
        'HP' => Tree.int_value(first_value(pk, %w[@totalhp])),
        'ATTACK' => Tree.int_value(first_value(pk, %w[@attack])),
        'DEFENSE' => Tree.int_value(first_value(pk, %w[@defense])),
        'SPECIAL_ATTACK' => Tree.int_value(first_value(pk, %w[@spatk])),
        'SPECIAL_DEFENSE' => Tree.int_value(first_value(pk, %w[@spdef])),
        'SPEED' => Tree.int_value(first_value(pk, %w[@speed]))
      }
      shared = shared_paths(pk, path)
      summary = pokemon_summary(pk, ref)
      summary.merge(
        fieldPath: path, shared: shared,
        exp: Tree.int_value(first_value(pk, %w[@exp @experience])),
        superShiny: first_value(pk, %w[@super_shiny]) == true,
        nature: nature_dto(pk), natureForStats: id_dto(:nature, first_value(pk, %w[@nature_for_stats])),
        ability: ability_dto(pk), abilityIndex: ability_index_of(pk),
        capabilities: { natureForStats: !Derived.legacy?(pk) },
        statusCount: Tree.int_value(first_value(pk, %w[@statusCount])),
        happiness: Tree.int_value(first_value(pk, %w[@happiness])),
        ball: Ids.of(first_value(pk, %w[@poke_ball @ballused])),
        iv: StatMap.read(iv), ev: evs, evTotal: evs.values.compact.sum,
        ivLayout: StatMap.layout(iv)&.to_s, evLayout: StatMap.layout(ev)&.to_s,
        stats: stats_info(pk, cached), growth: growth_info(pk),
        moves: move_dtos(pk), owner: owner_dto(pk), ribbons: ribbon_dtos(pk),
        personalId: Tree.int_value(first_value(pk, %w[@personalID @personal_id])),
        extras: extras_for(pk, Vanilla::POKEMON_DISPLAYED, Vanilla::POKEMON_OTHER, path),
        limits: limits
      )
    end

    # v16-18: la naturaleza es @natureflag (indice) o sale del ID personal; v19+: @nature.
    def nature_dto(pk)
      return id_dto(:nature, first_value(pk, %w[@nature @natureflag])) unless Derived.legacy?(pk)

      id = Derived.nature_id(pk)
      id && { id: id, name: name_of(:nature, id) }
    end

    # v16-18: @abilityflag es un INDICE de casilla; la habilidad real sale de la lista de la especie.
    def ability_dto(pk)
      return id_dto(:ability, first_value(pk, %w[@ability @abilityflag])) unless Derived.legacy?(pk)

      id = Derived.ability(@game, pk)
      id && { id: id, name: name_of(:ability, id) }
    end

    def ability_index_of(pk)
      Tree.int_value(first_value(pk, %w[@ability_index @abilityIndex])) || (Derived.legacy?(pk) ? Derived.ability_index(pk) : nil)
    end

    # Stats guardados vs los que da la formula del motor con los datos del juego.
    # `trusted` solo si la calibracion confirmo que la formula cuadra con este save.
    def stats_info(pk, cached)
      info = { cached: cached }
      return info unless @game&.species?

      f = PokeFacts.read(pk, @game)
      base = @game.base_stats(f.species, f.form)
      return info if base.size < 6 || f.level.nil? || f.iv.values.any?(&:nil?) || f.ev.values.any?(&:nil?)

      computed = GameData::Tables.calc_all(base, f.level, f.iv, f.ev, f.nature_for_stats || f.nature)
      info.merge(computed: computed, match: computed == cached, trusted: @calibration&.dig(:stats, :status) == 'ok')
    end

    # Grupo de experiencia y umbrales del nivel actual (para validar nivel/exp y ajustarlos juntos).
    def growth_info(pk)
      return nil unless @game&.species?

      f = PokeFacts.read(pk, @game)
      rate = @game.growth_rate(f.species, f.form)
      return nil if f.level.nil?

      { rate: rate, expAtLevel: GameData::Tables.exp_at(rate, f.level), expAtNext: GameData::Tables.exp_at(rate, f.level + 1),
        minimumLevel: @game.minimum_level(f.species) }
    end

    # Otros lugares del save donde aparece el MISMO nodo Pokemon.
    def shared_paths(pk, own_path)
      ref = @scan.pokemon_for(pk)
      return [] unless ref

      ref.occurrences.map { |e| Scan.path_of(e) }.reject { |p| p == own_path }
    end

    # ── Bolsa ─────────────────────────────────────────────────────────────────

    def bag_view
      b = binding(:bag)
      return nil unless b

      favourites = id_set(Tree.ivar(b.node, '@favourite_items'))
      registered = id_set(first_value(b.node, %w[@registered_items @registeredItems]))
      arr = b.array
      pockets = if b.layout == :flat
                  [pocket_dto(0, arr, b, 'all', favourites, registered)]
                else
                  reserved = arr.items.size >= 2 && Tree.array?(arr.items[0]) && arr.items[0].items.empty?
                  arr.items.each_with_index.filter_map do |p, i|
                    next if i.zero? && reserved

                    key = (arr.items.size == 9 && reserved) ? POCKET_KEYS[i - 1] : nil
                    pocket_dto(i, p, b, key, favourites, registered)
                  end
                end
      { ref: 'bag', fieldPath: b.path + Path.attr(b.ivar), layout: b.layout.to_s, pockets: pockets,
        totalItems: pockets.sum { |p| p[:count] },
        extras: extras_for(b.node, Vanilla::BAG_DISPLAYED, Vanilla::BAG_OTHER, b.path),
        limits: limits }
    end

    def id_set(node)
      return {} unless Tree.array?(node)

      node.items.filter_map { |x| Ids.of(x) }.to_h { |id| [id.to_s, true] }
    end

    def pocket_dto(index, pocket, binding, key, favourites, registered)
      items = Tree.array?(pocket) ? pocket.items : []
      slots = items.each_with_index.filter_map do |pair, si|
        next nil unless Shapes.item_pair?(pair)

        id = Ids.of(pair.items[0])
        { ref: "bag/#{index}/#{si}", id: id, name: name_of(:item, id), qty: Tree.int_value(pair.items[1]),
          favourite: favourites.key?(id.to_s), registered: registered.key?(id.to_s) }
      end
      { index: index, key: key, ref: "bag/#{index}", slots: slots, count: slots.size,
        fieldPath: binding.path + Path.attr(binding.ivar) + Path.index(index) }
    end

    # ── Extras ────────────────────────────────────────────────────────────────

    EDITABLE_KINDS = %w[int float str sym bool].freeze

    # Ivars del objeto que no tienen control propio. `custom` = no es vanilla.
    def extras_for(obj, displayed, other, base_path)
      return [] unless Tree.object?(obj)

      obj.attrs.filter_map do |k, v|
        n = k.name
        next if displayed.include?(n)

        s = Tree.summarize(v)
        { name: n, kind: s[:kind], display: s[:display], value: s[:value], count: s[:count],
          custom: !other.include?(n), editable: EDITABLE_KINDS.include?(s[:kind]),
          fieldPath: base_path + Path.attr(n) }
      end
    end

    # ── Claims (para la cobertura) ────────────────────────────────────────────

    def claims
      @claims ||= build_claims
    end

    def build_claims
      c = ClaimSet.new
      tb = binding(:trainer)
      c.claim_object(tb.node, Vanilla::TRAINER_DISPLAYED + Vanilla::TRAINER_OTHER) if tb
      bb = binding(:bag)
      c.claim_object(bb.node, Vanilla::BAG_DISPLAYED + Vanilla::BAG_OTHER) if bb
      sb = binding(:storage)
      if sb
        c.claim_object(sb.node, Vanilla::STORAGE_DISPLAYED + Vanilla::STORAGE_OTHER)
        sb.array.items.each { |box| c.claim_object(box, Vanilla::BOX_DISPLAYED + Vanilla::BOX_OTHER) }
      end
      known = Vanilla::POKEMON_DISPLAYED + Vanilla::POKEMON_OTHER
      @scan.pokemon.each { |ref| c.claim_object(ref.node, known) }
      c
    end
  end
end
