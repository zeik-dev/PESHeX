# =============================================================================
# guard.rb — Decide si una edicion INTRODUCE ilegalidades nuevas (lo que HeX
# rechaza). Compara las flags de las entidades tocadas ANTES y DESPUES de las
# ops, por identidad del NODO (no por posicion): mover un Pokemon entre el equipo
# y el PC no crea ilegalidades nuevas, y las que el save ya traia no bloquean
# ediciones ajenas. Un nodo nuevo (clonado/importado) cuenta con todas sus flags.
#
# Limitacion conocida: empeorar el valor de una flag que ya existia (p. ej. un EV
# ya ilegal que pasa de 300 a 400) no cuenta como flag nueva.
# =============================================================================

module Sem
  module Legality
    class IllegalEdit < StandardError
      attr_reader :flags

      def initialize(flags)
        super('illegal edit')
        @flags = flags
      end
    end

    class Guard
      Snapshot = Struct.new(:before)

      def initialize(session, engine)
        @session = session
        @engine = engine
        @model = Api.state!(session).model
        @scan = @model.scan
      end

      # Refs que una operacion toca (se leen ANTES de aplicarla).
      def self.refs_of_op(op)
        case op['op']
        when 'set' then ['trainer']
        when 'bag.set' then ['bag']
        when 'trainer.badge', 'box.patch' then []
        else [op['ref'], op['from'], op['to']].compact.map(&:to_s)
        end
      end

      def entities_for_refs(refs)
        ents = {}
        refs.each do |ref|
          e = @engine.entity_for_ref(ref)
          ents[e.id] ||= e if e
          ents[:party] ||= @engine.entity_for_ref('party') if ref.to_s.start_with?('party/') && @model.party_binding
        end
        ents
      end

      # Estado "antes": flags (por identidad) de las entidades que las ops van a tocar.
      def before_ops(ops)
        before_refs(ops.flat_map { |op| self.class.refs_of_op(op) })
      end

      def before_refs(refs)
        ents = entities_for_refs(refs)
        Snapshot.new(ents.transform_values { |e| @engine.flags_for(e).map(&:key).to_set })
      end

      # [[ref, Flag], ...] de las flags que aparecen tras la edicion y no estaban antes.
      def new_flags(snapshot, refs)
        ents = entities_for_refs(refs)
        out = []
        ents.each_value do |e|
          known = snapshot.before[e.id]
          if known.nil?
            # Un Pokemon del save original que no estaba entre las entidades de "antes" no es nuestro
            # asunto; uno nuevo (sin entrada en el recorrido inicial) cuenta entero.
            next unless e.kind == :pokemon && @scan.pokemon_for(e.node).nil?

            known = Set.new
          end
          @engine.flags_for(e).each { |f| out << [e.ref, f] unless known.include?(f.key) }
        end
        out
      end

      # ── Ediciones crudas (vista Avanzado): se localizan por ruta ──────────
      def entities_for_path(path)
        ents = {}
        @scan.pokemon.each do |pref|
          next unless pref.occurrences.any? { |occ| owns_path?(Scan.path_of(occ), path) }

          ents[pref.node.object_id] = Entity.new(pref.node.object_id, :pokemon, pref.node, nil)
        end
        tb = @model.binding(:trainer)
        ents[:trainer] = Entity.new(:trainer, :trainer, nil, 'trainer') if tb && owns_path?(tb.path, path)
        bb = @model.binding(:bag)
        ents[:bag] = Entity.new(:bag, :bag, nil, 'bag') if bb && owns_path?(bb.path, path)
        ents
      end

      def owns_path?(owner, path)
        return false if owner.empty?

        path == owner || (path.start_with?(owner) && ['@', '.', '[', '{'].include?(path[owner.length]))
      end

      def before_path(path)
        Snapshot.new(entities_for_path(path).transform_values { |e| @engine.flags_for(e).map(&:key).to_set })
      end

      def new_flags_for_path(snapshot, path)
        out = []
        entities_for_path(path).each_value do |e|
          known = snapshot.before[e.id]
          next unless known

          @engine.flags_for(e).each { |f| out << [e.ref, f] unless known.include?(f.key) }
        end
        out
      end

      # ── Guardado: todo el save contra la linea base de la sesion ──────────
      def new_flags_vs_baseline(baseline)
        out = []
        @engine.check_all.each do |ref, ent, flags|
          known = baseline[ent.id]
          if known.nil?
            next unless ent.kind == :pokemon && @scan.pokemon_for(ent.node).nil?

            known = Set.new
          end
          flags.each { |f| out << [ref, f] unless known.include?(f.key) }
        end
        out
      end
    end
  end
end
