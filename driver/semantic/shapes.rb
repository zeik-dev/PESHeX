# =============================================================================
# shapes.rb — Predicados de "forma": reconocen QUE es un nodo por su estructura,
# no por el nombre de su clase ni de su variable. Asi `@pockets[x][x][x]` y
# `@bag[x][x][x]` (y cualquier base custom) se detectan igual.
# =============================================================================

module Sem
  module Shapes
    module_function

    SPECIES_IVARS = %w[@species].freeze
    LEVEL_IVARS = %w[@level @exp].freeze

    # Un Pokemon: objeto con especie + (nivel o experiencia) + movimientos.
    def pokemon_like?(v)
      return false unless Tree.object?(v)

      names = v.attrs.map { |k, _| k.name }
      (names & SPECIES_IVARS).any? && (names & LEVEL_IVARS).any? && names.include?('@moves')
    end

    # Casilla de PC: nil o Pokemon.
    def box_slot?(v)
      v.nil? || pokemon_like?(v)
    end

    # Par [id, cantidad] de una ranura de bolsa.
    def item_pair?(x)
      return false unless Tree.array?(x) && x.items.size == 2

      id, qty = x.items
      (id.is_a?(RX::RxSym) || id.is_a?(Integer) || id.is_a?(RX::RxStr)) && Tree.integer?(qty)
    end

    # Array de bolsillos: Array<Array<[id,qty]|nil>>. `hint` = el ivar/clase
    # sugiere "bolsa" (permite aceptar una bolsa totalmente vacia).
    def pockets_like?(a, hint: false)
      return false unless Tree.array?(a) && a.items.size.between?(2, 24)
      return false unless a.items.all? { |p| p.nil? || Tree.array?(p) }

      nonempty = a.items.select { |p| Tree.array?(p) && !p.items.empty? }
      return hint if nonempty.empty?
      return false unless nonempty.all? { |p| p.items.all? { |s| s.nil? || item_pair?(s) } }

      nonempty.size >= 2 || hint || nonempty.sum { |p| p.items.size } >= 2
    end

    # Bolsa plana: Array<[id,qty]> (solo con pista de nombre/clase).
    def flat_bag_like?(a)
      Tree.array?(a) && !a.items.empty? && a.items.all? { |s| s.nil? || item_pair?(s) } &&
        a.items.any? { |s| !s.nil? }
    end

    # Caja de PC: objeto con un array (>= 10 casillas) de nil/Pokemon.
    # Devuelve [ivar, array] o nil.
    def box_like(b)
      return nil unless Tree.object?(b)

      b.attrs.each do |k, v|
        next unless Tree.array?(v) && v.items.size >= 10
        return [k.name, v] if v.items.all? { |s| box_slot?(s) }
      end
      nil
    end

    # Array de cajas (almacenamiento PC): >= 1 cajas y alguna con Pokemon, o
    # clases que lo sugieren.
    def boxes_like?(a, hint: false)
      return false unless Tree.array?(a) && !a.items.empty?
      return false unless a.items.all? { |b| box_like(b) }

      has_pokemon = a.items.any? do |b|
        _, arr = box_like(b)
        arr.items.any? { |s| !s.nil? }
      end
      has_pokemon || hint
    end

    # Equipo: array de 0..N Pokemon (o nil) dentro de un objeto con nombre.
    def party_array?(a)
      Tree.array?(a) && a.items.size <= 24 && a.items.all? { |s| box_slot?(s) }
    end
  end
end
