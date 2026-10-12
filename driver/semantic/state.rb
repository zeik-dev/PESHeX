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

    # Conecta (o desconecta con nil) los datos del juego vinculado.
    def attach_game(store, calibration)
      @model.game = store
      @model.calibration = calibration
    end
  end

  module Api
    module_function

    def open_payload(session)
      state!(session, redetect: true)
      { profile: session.semantic.resolved.summary }
    end

    def state!(session, redetect: false, override: nil)
      return session.semantic if session.semantic && !redetect

      session.semantic = State.detect(session.doc, override: override)
      session.semantic.attach_game(session.game, session.game_calibration)
      session.semantic
    end
  end
end
