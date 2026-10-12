# =============================================================================
# scan.rb — Un unico recorrido del arbol que reune candidatos a cada rol
# (trainer, bolsa, PC, Pokemon, Pokedex, estadisticas) y los nombres de juego
# embebidos en el save (GameData::*). No construye Fields ni rutas de texto:
# cada nodo apunta a su padre y la ruta solo se materializa bajo demanda.
# =============================================================================

module Sem
  class Scan
    # Eslabon del camino: [valor, padre, tipo_paso, dato_paso, multi_root]
    Entry = Struct.new(:value, :parent, :kind, :data, :multi)

    Candidate = Struct.new(:role, :owner, :ivar, :node, :entry, :class_name, :score, :evidence)
    PokemonRef = Struct.new(:node, :entry, :occurrences)

    GAMEDATA_KINDS = {
      'GameData::Species' => :species, 'GameData::Item' => :item, 'GameData::Move' => :move,
      'GameData::Ability' => :ability, 'GameData::Type' => :type, 'GameData::Nature' => :nature
    }.freeze

    attr_reader :pokemon, :trainers, :bags, :storages, :pokedexes, :stats, :names, :object_count,
                :roots

    def initialize(doc)
      @doc = doc
      @pokemon = []
      @poke_by_node = {}.compare_by_identity
      @trainers = []
      @bags = []
      @storages = []
      @pokedexes = []
      @stats = []
      @names = Hash.new { |h, k| h[k] = {} }
      @object_count = 0
      @roots = []
    end

    # PokemonRef de un nodo (o nil si no es un Pokemon visto en el recorrido).
    def pokemon_for(node)
      @poke_by_node[node]
    end

    # Ruta de texto (gramatica del Collector) de un eslabon.
    def self.path_of(entry)
      parts = []
      e = entry
      while e
        parts << step_text(e)
        e = e.parent
      end
      parts.reverse.join
    end

    def self.step_text(e)
      case e.kind
      when :root then Path.root(e.data, e.multi)
      when :attr then Path.attr(e.data)
      when :key then Path.key(e.data)
      when :idx then Path.index(e.data)
      when :data then '<data>'
      else ''
      end
    end

    def run
      multi = @doc.roots.size > 1
      stack = []
      (@doc.roots.size - 1).downto(0) do |i|
        entry = Entry.new(@doc.roots[i], nil, :root, i, multi)
        @roots << entry
        stack << entry
      end
      seen = {}.compare_by_identity

      until stack.empty?
        entry = stack.pop
        v = entry.value
        next unless v.is_a?(RX::Node)

        if (ref = @poke_by_node[v])
          ref.occurrences << entry
          next
        end
        next if seen[v]

        seen[v] = true

        case v
        when RX::RxObj, RX::RxStruct
          visit_object(v, entry)
          v.attrs.reverse_each { |k, x| push(stack, x, entry, :attr, k.name) }
        when RX::RxArr
          v.items.each_with_index.reverse_each { |x, i| push(stack, x, entry, :idx, i) }
        when RX::RxHash
          v.pairs.reverse_each { |k, x| push(stack, x, entry, :key, k) }
        when RX::RxUMarshal, RX::RxData
          push(stack, v.data, entry, :data, nil)
        end
      end
      self
    end

    private

    CONTAINER_CLASSES = [RX::RxObj, RX::RxStruct, RX::RxArr, RX::RxHash, RX::RxUMarshal, RX::RxData].freeze

    def push(stack, x, parent, kind, data)
      return unless CONTAINER_CLASSES.any? { |c| x.is_a?(c) }

      stack << Entry.new(x, parent, kind, data, false)
    end

    def visit_object(obj, entry)
      @object_count += 1
      cls = obj.class_name
      names = obj.attrs.map { |k, _| k.name }

      if (kind = GAMEDATA_KINDS[cls])
        record_gamedata_name(kind, obj)
      end

      if Shapes.pokemon_like?(obj)
        ref = PokemonRef.new(obj, entry, [entry])
        @pokemon << ref
        @poke_by_node[obj] = ref
        return # un Pokemon no contiene otros roles
      end

      bagish = cls.match?(/bag/i)
      storageish = cls.match?(/storage/i)
      has_name = names.include?('@name') && Tree.text(Tree.ivar(obj, '@name'))

      obj.attrs.each do |k, x|
        name = k.name
        next unless Tree.array?(x)

        trainerish = cls.match?(/trainer|player/i)
        if name == '@party' || (trainerish && has_name && x.items.any? { |s| s && Shapes.pokemon_like?(s) })
          if Shapes.party_array?(x) && (name == '@party' || x.items.any? { |s| !s.nil? })
            @trainers << Candidate.new(:trainer, obj, name, x, entry, cls, 0, [])
          end
        end

        if x.items.size.between?(2, 24) && Shapes.pockets_like?(x, hint: bagish || name.match?(/pocket|bag/i))
          @bags << Candidate.new(:bag, obj, name, x, entry, cls, 0, [])
        elsif bagish && name.match?(/bag|item/i) && Shapes.flat_bag_like?(x)
          @bags << Candidate.new(:bag, obj, name, x, entry, cls, 0, [:flat])
        end

        first = x.items.first
        if Tree.object?(first) && Shapes.box_like(first) &&
           Shapes.boxes_like?(x, hint: storageish || name.match?(/box/i))
          @storages << Candidate.new(:storage, obj, name, x, entry, cls, 0, [])
        end
      end

      @pokedexes << Candidate.new(:pokedex, obj, nil, obj, entry, cls, 0, []) if
        cls.match?(/pokedex/i) && names.include?('@seen') && names.include?('@owned')
      @stats << Candidate.new(:stats, obj, nil, obj, entry, cls, 0, []) if
        names.include?('@play_time') || cls.match?(/Stats\z/)
    end

    def record_gamedata_name(kind, obj)
      id = Ids.of(Tree.ivar(obj, '@id'))
      real = Tree.text(Tree.ivar(obj, '@real_name'))
      @names[kind][id.to_s] = real if id && real && !real.empty?
    end
  end
end
