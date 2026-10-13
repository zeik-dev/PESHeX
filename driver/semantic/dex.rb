# =============================================================================
# dex.rb — Donde guarda cada base el Pokedex. En Essentials v19+ es un objeto
# (`Player::Pokedex` con @seen/@owned hash), pero las bases v16-v18 y varios
# fangames (Infinite Fusion...) guardan @seen/@owned (arrays por numero de
# especie) directamente en el trainer, y algunas usan otros nombres.
# =============================================================================

module Sem
  module Dex
    SEEN = %w[@seen @seen_species].freeze
    OWNED = %w[@owned @caught @owned_species].freeze

    module_function

    def container?(v)
      Tree.hash?(v) || Tree.array?(v)
    end

    # { seen: '@seen'|nil, owned: '@owned'|nil }: los ivars que de verdad guardan el registro en `node`.
    def ivars(node)
      return { seen: nil, owned: nil } unless Tree.object?(node)

      {
        seen: SEEN.find { |n| container?(Tree.ivar(node, n)) },
        owned: OWNED.find { |n| container?(Tree.ivar(node, n)) }
      }
    end

    # ¿Tiene `node` el par visto/capturado? (por sus nombres de ivar, sin mirar valores: lo usa el escaneo)
    def pair_names?(names)
      !(names & SEEN).empty? && !(names & OWNED).empty?
    end

    def pair?(node)
      iv = ivars(node)
      !iv[:seen].nil? && !iv[:owned].nil?
    end
  end
end
