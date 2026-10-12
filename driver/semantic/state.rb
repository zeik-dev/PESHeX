# =============================================================================
# state.rb — Estado semantico de una sesion: deteccion + modelo + cobertura.
# =============================================================================

module Sem
  class State
    attr_reader :resolved, :model

    def initialize(resolved)
      @resolved = resolved
      @model = Model.new(resolved)
      @coverage = nil
    end

    def coverage
      @coverage ||= Coverage.new(@resolved, @model.claims).compute
    end

    def invalidate_coverage!
      @coverage = nil
    end

    def self.detect(doc, override: nil)
      new(Detector.detect(doc, override: override))
    end
  end

  module Api
    module_function

    def open_payload(session)
      session.semantic = State.detect(session.doc)
      { profile: session.semantic.resolved.summary }
    end

    def state!(session)
      session.semantic || (session.semantic = State.detect(session.doc))
    end
  end
end
