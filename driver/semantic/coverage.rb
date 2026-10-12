# =============================================================================
# coverage.rb — Cobertura de clasificacion: a que "bucket" pertenece cada hoja
# del save.
#
#   classified   reclamada por una vista (o dato vanilla conocido de una entidad)
#   custom       dato extra de una entidad conocida o de una base custom (overlay)
#   world        estado del motor/mundo (mapas, switches, variables, sistema...)
#   unclassified nada la reconoce -> aparece en "Sin clasificar"
#
# La suma de buckets debe igualar la cantidad de campos del Collector (mismas
# reglas de recorrido: contenedores compartidos se expanden una sola vez).
# =============================================================================

module Sem
  class Coverage
    Group = Struct.new(:cls, :ivar, :bucket, :leaf_count, :sample_path)

    def initialize(resolved, claims)
      @resolved = resolved
      @claims = claims
      @profile = resolved.profile
    end

    def compute
      @totals = Hash.new(0)
      @groups = {}
      @seen = {}.compare_by_identity
      @stack = []

      roots = @resolved.doc.roots
      multi = roots.size > 1
      if @resolved.facts.root_form == :hash_root
        walk_root_hash(roots[0])
      else
        roots.each_with_index { |r, i| walk_multi_root(r, i, multi) }
      end
      drain

      total = @totals.values.sum
      groups = @groups.values.sort_by { |g| -g.leaf_count }.map do |g|
        { key: "#{g.cls}##{g.ivar}",
          class: g.cls, ivar: g.ivar, bucket: g.bucket.to_s, leafCount: g.leaf_count, samplePath: g.sample_path }
      end
      { total: total, buckets: ClaimSet::BUCKETS.to_h { |b| [b, @totals[b]] }, groups: groups }
    end

    private

    # Frame: [entry, bucket, group]
    def push_frame(entry, bucket, group)
      @stack << [entry, bucket, group]
    end

    def count(bucket, group)
      @totals[bucket] += 1
      group.leaf_count += 1 if group
    end

    def group_for(cls, ivar, bucket, owner_entry)
      key = [cls, ivar, bucket]
      @groups[key] ||= Group.new(cls, ivar, bucket, 0, sample_path(owner_entry, ivar))
    end

    def sample_path(owner_entry, ivar)
      base = Scan.path_of(owner_entry)
      ivar.start_with?('@') ? base + ivar : (base.empty? ? ".#{ivar}" : base)
    end

    def container?(v)
      Scan::CONTAINER_CLASSES.any? { |c| v.is_a?(c) }
    end

    # Asigna un valor (hoja o contenedor) a (bucket, group).
    def place(value, parent_entry, kind, data, bucket, group)
      if Tree.leaf?(value)
        count(bucket, group)
      elsif container?(value)
        push_frame(Scan::Entry.new(value, parent_entry, kind, data, false), bucket, group)
      end
    end

    def walk_root_hash(hash)
      @seen[hash] = true
      root_entry = Scan::Entry.new(hash, nil, :root, 0, false)
      hash.pairs.each do |k, v|
        key = Tree.key_name(k).to_s
        bucket = if @profile.world_root_keys.include?(key) then :world
                 elsif @resolved.custom_root_keys.include?(key) then :custom
                 end
        if bucket
          group = group_for('(raiz)', key, bucket, root_entry)
          place(v, root_entry, :key, k, bucket, group)
        elsif Tree.leaf?(v)
          count(:unclassified, group_for('(raiz)', key, :unclassified, root_entry))
        else
          place(v, root_entry, :key, k, nil, nil)
        end
      end
    end

    def walk_multi_root(root, index, multi)
      entry = Scan::Entry.new(root, nil, :root, index, multi)
      if Tree.leaf?(root)
        count(:world, group_for('(raiz)', "$#{index}", :world, entry))
      elsif container?(root)
        push_frame(entry, nil, nil)
      end
    end

    def drain
      until @stack.empty?
        entry, bucket, group = @stack.pop
        v = entry.value
        next unless v.is_a?(RX::Node)
        next if @seen[v]

        @seen[v] = true
        case v
        when RX::RxObj, RX::RxStruct then expand_object(v, entry, bucket, group)
        when RX::RxArr then v.items.each_with_index { |x, i| place(x, entry, :idx, i, bucket || :unclassified, group) }
        when RX::RxHash then v.pairs.each { |k, x| place(x, entry, :key, k, bucket || :unclassified, group) }
        when RX::RxUMarshal, RX::RxData then place(v.data, entry, :data, nil, bucket || :unclassified, group)
        end
      end
    end

    def expand_object(obj, entry, bucket, group)
      cls = obj.class_name
      entity = @claims.entity?(obj)
      world = bucket.nil? && cls.match?(@profile.world_classes)
      obj.attrs.each do |k, x|
        name = k.name
        if entity
          b = @claims.lookup(obj, name) || :custom
          g = group_for(cls, name, b, entry)
        elsif bucket
          b = bucket
          g = group
        else
          b = world ? :world : :unclassified
          g = group_for(cls, name, b, entry)
        end
        place(x, entry, :attr, name, b, g)
      end
    end
  end
end
