# =============================================================================
# extras.rb — Vistas de lectura de las secciones "extra" del save: Pokedex,
# interruptores y variables del mundo (con los nombres de System.rxdata si hay
# carpeta de juego), estadisticas, Salon de la Fama y busqueda global.
# =============================================================================

module Sem
  class Extras
    WORLD_KINDS = { 'switches' => /Game_Switches/, 'variables' => /Game_Variables/ }.freeze

    def initialize(session)
      @session = session
      @state = Api.state!(session)
      @model = @state.model
      @doc = session.doc
    end

    # ── Pokedex ───────────────────────────────────────────────────────────────

    def pokedex_node
      @model.binding(:pokedex)
    end

    def dex_ids(node, hash_key)
      v = Tree.ivar(node, hash_key)
      if Tree.hash?(v)
        v.pairs.filter_map { |k, val| Tree.key_name(k) if val == true || (val.is_a?(Integer) && val.positive?) }
      elsif Tree.array?(v)
        v.items.each_with_index.filter_map { |val, i| i.to_s if val == true } # numero de especie, como texto (igual que las claves del hash)
      else
        []
      end
    end

    def counts_map(node, key)
      v = Tree.ivar(node, key)
      return {} unless Tree.hash?(v)

      v.pairs.each_with_object({}) { |(k, val), h| h[Tree.key_name(k)] = Tree.int_value(val) if Tree.integer?(val) }
    end

    def pokedex
      b = pokedex_node
      return { available: false } unless b

      node = b.node
      iv = Dex.ivars(node)
      seen_node = iv[:seen] && Tree.ivar(node, iv[:seen])
      seen = iv[:seen] ? dex_ids(node, iv[:seen]) : []
      owned = iv[:owned] ? dex_ids(node, iv[:owned]) : []
      caught = counts_map(node, '@caught_counts')
      defeated = counts_map(node, '@defeated_counts')
      ids = (seen + owned + caught.keys + defeated.keys).uniq
      unlocked = Tree.ivar(node, '@unlocked_dexes')
      {
        available: true, path: b.path, layout: Tree.hash?(seen_node) ? 'hash' : 'array',
        seen: seen, owned: owned, caught: caught, defeated: defeated, ids: ids,
        unlockedDexes: Tree.array?(unlocked) ? unlocked.items.each_with_index.filter_map { |x, i| i if x == true } : nil
      }
    end

    # ── Interruptores y variables ─────────────────────────────────────────────

    # Nodo Game_Switches / Game_Variables y su array @data (o nil).
    def world_data(kind)
      pattern = WORLD_KINDS.fetch(kind) { raise DriverError.new('ValidationError', "tipo de mundo desconocido: #{kind}", { code: 'unknown_world', kind: kind }) }
      roots = @doc.roots
      holders = if Tree.hash?(roots.first)
                  roots.first.pairs.map { |k, v| [v, "#{Path.root(0, false)}#{Path.key(k)}"] }
                else
                  roots.each_with_index.map { |v, i| [v, Path.root(i, roots.size > 1)] }
                end
      holders.each do |node, path|
        next unless Tree.object?(node) && Tree.class_name(node).to_s.match?(pattern)

        data = Tree.ivar(node, '@data')
        return [data, "#{path}@data"] if Tree.array?(data)
      end
      nil
    end

    def world_names(kind)
      sys = @session.game&.system_data
      sys && sys[kind.to_sym]
    end

    def world(kind, q: '', page: 0, page_size: 100, only_non_default: false)
      found = world_data(kind)
      return { available: false, kind: kind } unless found

      arr, path = found
      names = world_names(kind) || []
      needle = q.to_s.downcase.strip
      rows = arr.items.each_with_index.filter_map do |v, i|
        next if i.zero?

        value = Tree.summarize(v)
        next if only_non_default && default_value?(kind, v)

        name = names[i]
        next unless needle.empty? || i.to_s == needle || name.to_s.downcase.include?(needle) || value[:display].to_s.downcase.include?(needle)

        { id: i, name: name.to_s.empty? ? nil : name, value: value }
      end
      page = [page.to_i, 0].max
      size = page_size.to_i.clamp(1, 500)
      { available: true, kind: kind, path: path, total: rows.size, count: arr.items.size - 1, page: page, pageSize: size,
        named: !names.empty?, rows: rows[page * size, size] || [] }
    end

    def default_value?(kind, v)
      kind == 'switches' ? v != true : (v.nil? || v == 0)
    end

    # ── Estadisticas y Salon de la Fama ───────────────────────────────────────

    def stats
      b = @model.binding(:stats)
      return { available: false } unless b

      entries = b.node.attrs.filter_map do |k, v|
        next unless Tree.leaf?(v) || (v.is_a?(RX::RxUDef) && v.class_name == 'Time')

        name = k.name.sub(/\A@/, '')
        { name: name, value: Tree.summarize(v), group: stat_group(name) }
      end
      { available: true, path: b.path, playTime: @model.play_time, entries: entries }
    end

    STAT_GROUPS = [
      [/battle|exp_gained|blacked|defeat|attempt|hall_of_fame|mega|primal|purified|shadow/, 'battle'],
      [/money|coins|mart|items_bought|premier|drinks|battle_points|soot/, 'money'],
      [/distance|walked|cycle|surf|fly|dive|bump|slid|teleport|dig|waterfall|rockclimb/, 'travel'],
      [/egg|day_care|evolution|trade|pokerus|revived|moves_taught|berr/, 'pokemon'],
      [/time|play/, 'time']
    ].freeze

    def stat_group(name)
      STAT_GROUPS.each { |re, g| return g if name.match?(re) }
      'other'
    end

    def hall_of_fame
      holder = %i[trainer global stats storage].filter_map { |r| @model.binding(r) }.find do |b|
        b.node.attrs.any? { |k, _| k.name.match?(/hall.?of.?fame/i) }
      end
      return { available: false } unless holder

      pair = holder.node.attrs.find { |k, _| k.name.match?(/hall.?of.?fame/i) }
      path = "#{holder.path}#{Path.attr(pair[0].name)}"
      value = pair[1]
      entries = Tree.array?(value) ? value.items.each_with_index.map { |e, i| hof_entry(e, i) } : []
      { available: true, path: path, entries: entries }
    end

    def hof_entry(entry, index)
      members = Tree.array?(entry) ? entry.items : [entry]
      mons = members.each_with_index.filter_map do |m, j|
        @model.pokemon_summary(m, "hof/#{index}/#{j}") if Tree.object?(m) && Shapes.pokemon_like?(m)
      end
      { index: index, members: mons, display: Tree.summarize(entry)[:display] }
    end

    # ── Busqueda global ───────────────────────────────────────────────────────

    def search(q, limit: 8)
      needle = norm(q)
      return { q: q.to_s, total: 0, groups: {} } if needle.empty?

      groups = { pokemon: pokemon_hits(needle, limit), items: item_hits(needle, limit), boxes: box_hits(needle, limit),
                 world: world_hits(needle, limit) }.reject { |_, v| v.empty? }
      { q: q.to_s, total: groups.values.sum(&:size), groups: groups }
    end

    def norm(s)
      s.to_s.unicode_normalize(:nfd).gsub(/\p{Mn}/, '').upcase.gsub(/[^A-Z0-9]/, '')
    end

    def hit?(needle, *texts)
      texts.any? { |t| t && norm(t).include?(needle) }
    end

    def pokemon_hits(needle, limit)
      out = []
      each_pokemon do |ref, pk|
        s = @model.pokemon_summary(pk, ref)
        sp_name = s.dig(:species, :name)
        next unless hit?(needle, s[:nickname], sp_name, s.dig(:species, :id).to_s)

        out << { ref: ref, label: s[:nickname] || sp_name, sub: [sp_name, s[:level] && "Nv. #{s[:level]}", location_label(ref)].compact.join(' · ') }
        break if out.size >= limit
      end
      out
    end

    def each_pokemon
      @model.party_items.each_with_index { |pk, i| yield "party/#{i}", pk if pk }
      @model.box_arrays.each_with_index do |(_b, _iv, arr), bi|
        arr&.items&.each_with_index { |pk, si| yield "box/#{bi}/#{si}", pk if pk }
      end
    end

    def location_label(ref)
      kind, a, = ref.split('/')
      return 'party' if kind == 'party'

      { 'box' => Tree.text(Tree.ivar(@model.box_arrays[a.to_i]&.first, '@name')) || "box #{a.to_i + 1}" }['box']
    end

    def item_hits(needle, limit)
      bag = @model.bag_view
      return [] unless bag

      out = []
      bag[:pockets].each do |pocket|
        pocket[:slots].each do |s|
          next unless hit?(needle, s[:name], s[:id].to_s)

          out << { ref: s[:ref], id: s[:id], label: s[:name], sub: "x#{s[:qty]}" }
          return out if out.size >= limit
        end
      end
      out
    end

    def box_hits(needle, limit)
      boxes = @model.boxes_view
      return [] unless boxes

      boxes[:boxes].filter_map do |b|
        { index: b[:index], label: b[:name] || "#{b[:index] + 1}", sub: "#{b[:filled]}" } if hit?(needle, b[:name])
      end.first(limit)
    end

    def world_hits(needle, limit)
      out = []
      %w[switches variables].each do |kind|
        names = world_names(kind)
        next unless names

        names.each_with_index do |n, i|
          next if i.zero? || n.to_s.empty? || !hit?(needle, n)

          out << { kind: kind, id: i, label: n, sub: kind }
          break if out.size >= limit
        end
      end
      out.first(limit)
    end
  end
end
