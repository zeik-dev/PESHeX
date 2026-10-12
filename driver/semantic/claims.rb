# =============================================================================
# claims.rb — Registro de qué (objeto, ivar) "reclama" cada vista semantica.
#
# Sirve para medir la cobertura: una hoja del save pertenece al bucket del
# ivar que la contiene (classified / custom / world / unclassified). Un ivar
# de una entidad conocida (Pokemon, trainer...) que la app no mapea se
# reclama como :custom (aparece en "extras" de esa entidad, nunca se pierde).
# =============================================================================

module Sem
  class ClaimSet
    BUCKETS = %i[classified custom world unclassified].freeze

    def initialize
      @map = {}.compare_by_identity
    end

    # Reclama un ivar concreto de un objeto.
    def claim(obj, ivar, bucket = :classified)
      (@map[obj] ||= {})[ivar] = bucket
    end

    # Reclama TODOS los ivars del objeto: los `known` como :classified y el
    # resto como :custom.
    def claim_object(obj, known)
      return unless Tree.object?(obj)

      obj.attrs.each do |k, _|
        name = k.name
        claim(obj, name, known.include?(name) ? :classified : :custom)
      end
    end

    def lookup(obj, ivar)
      @map.dig(obj, ivar)
    end

    def entity?(obj)
      @map.key?(obj)
    end
  end
end
