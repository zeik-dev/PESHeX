# =============================================================================
# detector.rb — Deteccion de la base de Essentials y de los ROLES del save.
#
#   1. Scan: un recorrido reune candidatos por forma (trainer/bolsa/PC/...).
#   2. Hechos baratos (forma de la raiz, claves, version, estilo de IDs...).
#   3. Cada perfil puntua; gana el mejor (el usuario puede forzar otro).
#   4. Los roles se enlazan primero por las pistas del perfil y, si fallan,
#      por descubrimiento de forma. Asi `@pockets` y `@bag` salen igual.
#   5. Confianza alta/media/baja + ambiguedades (varios candidatos parecidos).
# =============================================================================

module Sem
  Binding = Struct.new(:role, :node, :path, :class_name, :via, :ivar, :array, :layout, :entry, :score,
                       keyword_init: true)

  Resolved = Struct.new(:doc, :profile, :scan, :facts, :bindings, :confidence, :score, :evidence,
                        :ambiguities, :overlays, :alternatives, :confirmed, keyword_init: true) do
    def binding(role)
      bindings[role]
    end

    def editable?
      confidence != 'low' || confirmed
    end

    def custom_root_keys
      overlays.flat_map { |o| o[:rootKeys] || [] }
    end

    def summary
      {
        id: profile.id, family: profile.family, label: profile.label, format: profile.format.to_s,
        essentialsVersion: facts.essentials_version, gameVersion: facts.game_version,
        confidence: confidence, score: score.round(3), evidence: evidence, ambiguities: ambiguities,
        overlays: overlays.map { |o| o.reject { |k, _| k == :rootKeys } },
        idStyle: facts.species_style&.to_s, statLayout: facts.stat_style&.to_s,
        editable: editable?, confirmed: confirmed ? true : false,
        roles: bindings.transform_values { |b| { path: b.path, class: b.class_name, via: b.via.to_s, ivar: b.ivar } },
        alternatives: alternatives,
        counts: { pokemon: scan.pokemon.size, objects: scan.object_count }
      }
    end
  end

  module Detector
    module_function

    ROLES = %i[trainer bag storage pokedex stats global].freeze

    def detect(doc, override: nil)
      scan = Scan.new(doc).run
      facts = build_facts(doc, scan)
      discovered = discover(scan)
      scored = Profiles.all.map do |p|
        s, ev = p.scorer.call(facts, discovered.keys)
        { profile: p, score: s, evidence: ev }
      end.sort_by { |h| -h[:score] }

      chosen = override ? (scored.find { |h| h[:profile].id == override } || scored.first) : scored.first
      second = scored.find { |h| !h.equal?(chosen) }
      margin = chosen[:score] - (second ? second[:score] : 0.0)

      bindings, ambiguities = resolve_roles(chosen[:profile], doc, scan, facts, discovered)
      confidence = rate(chosen, margin, bindings, ambiguities)
      resolved = Resolved.new(
        doc: doc, profile: chosen[:profile], scan: scan, facts: facts, bindings: bindings,
        confidence: confidence, score: chosen[:score], evidence: chosen[:evidence],
        ambiguities: ambiguities, overlays: [], confirmed: !override.nil?,
        alternatives: scored.reject { |h| h.equal?(chosen) }.first(2).map { |h| { id: h[:profile].id, score: h[:score].round(3) } }
      )
      resolved.overlays = detect_overlays(resolved)
      resolved
    end

    # ── Hechos ────────────────────────────────────────────────────────────────

    def build_facts(doc, scan)
      roots = doc.roots
      form = if roots.size > 1 then :multi_root
             elsif roots.size == 1 && Tree.hash?(roots[0]) then :hash_root
             else :single
             end
      keys = form == :hash_root ? Tree.hash_keys(roots[0]).compact : []
      classes = if form == :hash_root
                  roots[0].pairs.map { |_, v| Tree.class_name(v) }.compact
                else
                  roots.map { |r| Tree.class_name(r) }
                end
      sample = scan.pokemon.first&.node
      species = sample && Tree.ivar(sample, '@species')
      iv = sample && Tree.ivar(sample, '@iv')
      Facts.new(
        root_form: form, root_keys: keys, root_classes: classes,
        essentials_version: form == :hash_root ? Tree.text(Tree.hash_get(roots[0], 'essentials_version')) : nil,
        game_version: form == :hash_root ? Tree.text(Tree.hash_get(roots[0], 'game_version')) : nil,
        species_style: Ids.style(species)&.then { |s| s == :string ? :symbol : s },
        stat_style: StatMap.layout(iv), pokemon_count: scan.pokemon.size
      )
    end

    # ── Descubrimiento por forma (independiente del perfil) ───────────────────

    def rank_trainer(c)
      s = 0.0
      s += 3 if c.ivar == '@party'
      s += 2 if c.class_name.to_s.match?(/player|trainer/i)
      s += 1 if Tree.ivar?(c.owner, '@money')
      s += 0.1 * c.node.items.count { |x| !x.nil? }
      s
    end

    def rank_bag(c)
      count = c.node.items.sum { |p| Tree.array?(p) ? p.items.size : 1 }
      s = [count, 40].min * 0.1
      s += 5 if c.class_name.to_s.match?(/bag/i)
      s += 3 if c.ivar.to_s.match?(/pocket/i)
      s
    end

    def rank_storage(c)
      s = c.node.items.size * 0.05
      s += 5 if c.class_name.to_s.match?(/storage/i)
      s += 2 if c.ivar.to_s.match?(/box/i)
      filled = c.node.items.sum do |b|
        slots = Shapes.box_like(b)&.last
        slots ? slots.items.count { |x| !x.nil? } : 0
      end
      s + filled * 0.01
    end

    def rank_pokedex(c)
      s = 1.0
      s += 2 if c.class_name.to_s.match?(/pokedex/i)
      s
    end

    def rank_stats(c)
      s = 1.0
      s += 3 if c.class_name.to_s.match?(/Stats\z/)
      s += 1 if Tree.ivar?(c.owner, '@play_time')
      s
    end

    def ranked(role, list)
      fn = method("rank_#{role}")
      list.each { |c| c.score = fn.call(c) }
      list.sort_by { |c| -c.score }
    end

    def discover(scan)
      out = {}
      { trainer: scan.trainers, bag: scan.bags, storage: scan.storages,
        pokedex: scan.pokedexes, stats: scan.stats }.each do |role, list|
        r = ranked(role, list)
        out[role] = r unless r.empty?
      end
      out
    end

    # ── Enlace de roles ───────────────────────────────────────────────────────

    def candidates_for(scan, role)
      { trainer: scan.trainers, bag: scan.bags, storage: scan.storages,
        pokedex: scan.pokedexes, stats: scan.stats }[role] || []
    end

    def resolve_roles(profile, doc, scan, facts, discovered)
      bindings = {}
      ambiguities = []
      ROLES.each do |role|
        hinted = hinted_owner(profile, role, doc, facts)
        if hinted
          cand = candidates_for(scan, role).find { |c| c.owner.equal?(hinted[:node]) }
          bindings[role] = if cand
                             binding_from_candidate(role, cand, :profile)
                           elsif %i[stats global].include?(role) || (role == :pokedex)
                             Binding.new(role: role, node: hinted[:node], path: hinted[:path],
                                         class_name: Tree.class_name(hinted[:node]), via: :profile, score: 1.0)
                           end
          next if bindings[role]
        end

        list = discovered[role]
        next unless list

        bindings[role] = binding_from_candidate(role, list.first, :discovered)
        close = list.select { |c| c.score >= list.first.score * 0.8 && !c.owner.equal?(list.first.owner) }
        next if close.empty?

        ambiguities << { role: role.to_s,
                         candidates: ([list.first] + close).first(4).map do |c|
                           { path: Scan.path_of(c.entry), class: c.class_name, score: c.score.round(2) }
                         end }
      end

      # El Pokedex vive normalmente en @pokedex del trainer.
      if !bindings[:pokedex] && bindings[:trainer]
        dex = Tree.ivar(bindings[:trainer].node, '@pokedex')
        if Tree.object?(dex)
          bindings[:pokedex] = Binding.new(role: :pokedex, node: dex,
                                           path: bindings[:trainer].path + Path.attr('@pokedex'),
                                           class_name: dex.class_name, via: :discovered, score: 1.0)
        end
      end
      # Bases v16-v18 y fangames (Infinite Fusion...): @seen/@owned viven directamente en el trainer.
      if !bindings[:pokedex] && bindings[:trainer] && Dex.pair?(bindings[:trainer].node)
        t = bindings[:trainer]
        bindings[:pokedex] = Binding.new(role: :pokedex, node: t.node, path: t.path, class_name: t.class_name,
                                         via: :discovered, score: 0.8)
      end
      [bindings, ambiguities]
    end

    def binding_from_candidate(role, cand, via)
      layout = cand.evidence.include?(:flat) ? :flat : :pockets
      Binding.new(role: role, node: cand.owner, path: Scan.path_of(cand.entry), class_name: cand.class_name,
                  via: via, ivar: cand.ivar, array: cand.node, layout: role == :bag ? layout : nil,
                  entry: cand.entry, score: cand.score)
    end

    # Nodo sugerido por el perfil para un rol: { node:, path: } o nil.
    def hinted_owner(profile, role, doc, facts)
      hint = profile.role_hints[role]
      return nil unless hint

      if hint[:root_key] && facts.root_form == :hash_root
        pair = Tree.hash_pair(doc.roots[0], hint[:root_key])
        return nil unless pair && Tree.object?(pair.last)

        { node: pair.last, path: Path.key(pair.first) }
      elsif hint[:root_class] && facts.root_form == :multi_root
        i = doc.roots.index { |r| Tree.class_name(r).to_s.match?(hint[:root_class]) }
        return nil unless i

        { node: doc.roots[i], path: Path.root(i, true) }
      end
    end

    # ── Confianza ─────────────────────────────────────────────────────────────

    def rate(chosen, margin, bindings, ambiguities)
      score = chosen[:score]
      level = if score >= 0.8 && margin > 0.3 then 2
              elsif score >= 0.5 then 1
              else 0
              end
      level = [level, 1].min if chosen[:profile].id == 'generic'
      level -= 1 unless ambiguities.empty?
      level = 0 unless bindings[:trainer]
      level = [level, 0].max
      %w[low medium high][level]
    end

    # ── Overlays (extras conocidos de bases custom) ───────────────────────────

    def detect_overlays(resolved)
      keys = resolved.facts.root_keys
      signals = []
      custom_keys = %w[item_log randomized_data].select { |k| keys.include?(k) }
      signals << { code: 'root_keys', params: { keys: custom_keys } } unless custom_keys.empty?
      bag = resolved.binding(:bag)
      if bag && Tree.ivar?(bag.node, '@favourite_items')
        signals << { code: 'bag_favourites', params: {} }
      end
      return [] if signals.empty?

      [{ id: 'sky_v21', confidence: 'possible', evidence: signals, rootKeys: custom_keys }]
    end
  end
end
