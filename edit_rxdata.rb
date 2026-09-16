#!/usr/bin/env ruby
# =============================================================================
# edit_rxdata.rb — Editor interactivo de archivos .rxdata (Save File)
#
# Uso:
#   ruby edit_rxdata.rb Partida.rxdata
#   ruby edit_rxdata.rb Partida.rxdata --no-color
#   ruby edit_rxdata.rb Partida.rxdata --output OtraPartida.rxdata
#   ruby edit_rxdata.rb Partida.rxdata --scripts "C:/Juegos/MiJuego"
#   ruby edit_rxdata.rb Partida.rxdata --nil-report
#   ruby edit_rxdata.rb Partida.rxdata --check
#
# Que hace distinto a la version anterior:
#   * No usa Marshal.load ni clases stub: lee el formato Marshal directamente,
#     asi funciona con CUALQUIER clase de mods/plugins (Structs, subclases de
#     Hash/Array/String, objetos extend, _dump, marshal_dump...) y lo que no se
#     edita se reescribe identico byte a byte (se verifica al cargar).
#   * Lee TODOS los objetos del archivo (RMXP y Essentials <= v18 guardan
#     varios seguidos; Essentials v19+ guarda un Hash). Soporta zlib.
#   * Los campos nil ya no se descartan: se infiere su tipo con la propia
#     partida (misma variable en otras instancias), los scripts del juego
#     (literales, YARD, validate, herencia...) y el nombre de la variable.
#   * Muestra y edita Symbols (:POTION), permite cambiar el tipo con prefijos
#     (int: str: sym: ...), crear [] / {} y copiar objetos como plantilla.
#   * Hace copia .bak con fecha antes de sobrescribir y guarda de forma atomica.
# =============================================================================

require 'optparse'
require 'zlib'
require 'fileutils'
begin
  require 'ripper'
rescue LoadError
  nil # sin Ripper se usa un analisis simple por expresiones regulares
end

module C
  RESET   = "\e[0m"
  BOLD    = "\e[1m"
  DIM     = "\e[2m"
  RED     = "\e[31m"
  GREEN   = "\e[32m"
  YELLOW  = "\e[33m"
  BLUE    = "\e[34m"
  CYAN    = "\e[36m"
  MAGENTA = "\e[35m"
  def self.disable!
    constants.each { |c| remove_const(c); const_set(c, "") }
  end
end

# ──────────────────────────────────────────────────────────────────────────────
# NUCLEO MARSHAL (lector/escritor propio, sin definir clases del juego)
#
# En vez de Marshal.load + clases stub, el archivo se lee como un arbol de
# nodos que conserva TODO: nombres de clase, ivars, enlaces compartidos (@),
# simbolos, codificaciones, datos binarios de _dump, Structs, subclases de
# Hash/Array/String, objetos extendidos, etc. Al guardar se reescribe con el
# mismo algoritmo, asi que lo que no se toca queda identico byte a byte.
# ──────────────────────────────────────────────────────────────────────────────
module RxMarshal
  BIN = Encoding::ASCII_8BIT

  class FormatError < StandardError; end

  class Node
    attr_accessor :ivars, :extends, :uclass   # ivars: nil o [[RxSym, valor], ...]
  end

  class RxSym
    attr_reader :bytes
    attr_accessor :ivars
    def initialize(bytes, ivars = nil)
      @bytes = bytes.b.freeze
      @ivars = ivars
    end
    def name; @name ||= RxMarshal.to_utf8(@bytes); end
    alias to_s name
    def inspect; ":#{name}"; end
  end

  class RxStr < Node
    attr_accessor :bytes
    def initialize(bytes); @bytes = bytes; end
    def encoding_name; RxMarshal.encoding_from_ivars(@ivars); end
    def text; RxMarshal.to_utf8(@bytes, encoding_name); end
  end

  class RxFloat < Node
    attr_reader :raw
    def initialize(raw); @raw = raw; end
    def value
      s = @raw.split("\0", 2).first.to_s   # Ruby 1.8 agrega bytes de mantisa tras un \0
      case s
      when 'nan'  then Float::NAN
      when 'inf'  then Float::INFINITY
      when '-inf' then -Float::INFINITY
      else (Float(s) rescue s.to_f)
      end
    end
    def self.from_f(f)
      v, = Reader.new(Marshal.dump(f.to_f), {}).read_stream
      v
    end
  end

  class RxBig < Node
    attr_reader :sign, :data
    def initialize(sign, data); @sign = sign; @data = data; end
    def value
      n = 0
      @data.bytes.each_with_index { |b, i| n |= b << (8 * i) }
      @sign == '-' ? -n : n
    end
  end

  class RxRegexp < Node
    attr_accessor :source, :options, :inner_ivars
    def initialize(source, options); @source = source; @options = options; end
  end

  class RxArr < Node
    attr_accessor :items
    def initialize(items); @items = items; end
  end

  class RxHash < Node
    attr_accessor :pairs, :default, :has_default
    def initialize(pairs); @pairs = pairs; @has_default = false; end
  end

  class RxObj < Node          # 'o'  objeto normal con ivars
    attr_accessor :klass, :attrs
    def initialize(klass, attrs); @klass = klass; @attrs = attrs; end
    def class_name; @klass.name; end
  end

  class RxStruct < Node       # 'S'  Struct
    attr_accessor :klass, :attrs
    def initialize(klass, attrs); @klass = klass; @attrs = attrs; end
    def class_name; @klass.name; end
  end

  class RxUDef < Node         # 'u'  _dump / _load (Table, Color, Tone, Time...)
    attr_accessor :klass, :bytes, :inner_ivars
    def initialize(klass, bytes); @klass = klass; @bytes = bytes; end
    def class_name; @klass.name; end
  end

  class RxUMarshal < Node     # 'U'  marshal_dump / marshal_load
    attr_accessor :klass, :data
    def initialize(klass, data); @klass = klass; @data = data; end
    def class_name; @klass.name; end
  end

  class RxData < Node         # 'd'  (muy raro)
    attr_accessor :klass, :data
    def initialize(klass, data); @klass = klass; @data = data; end
    def class_name; @klass.name; end
  end

  class RxClassRef < Node     # 'c' / 'm' / 'M'
    attr_accessor :kind, :name_bytes
    def initialize(kind, name_bytes); @kind = kind; @name_bytes = name_bytes; end
    def class_name; RxMarshal.to_utf8(@name_bytes); end
  end

  CLASSY = [RxObj, RxStruct, RxUDef, RxUMarshal, RxData].freeze

  def self.to_utf8(bytes, enc_name = nil)
    s = bytes.dup
    if enc_name && !%w[UTF-8 US-ASCII].include?(enc_name)
      enc = (Encoding.find(enc_name) rescue nil)
      return s.force_encoding(enc).encode('UTF-8', invalid: :replace, undef: :replace) if enc
    end
    s.force_encoding('UTF-8')
    s.valid_encoding? ? s : s.scrub('?')
  end

  def self.encoding_from_ivars(ivars)
    return nil unless ivars
    ivars.each do |k, v|
      case k.name
      when 'E'        then return(v == true ? 'UTF-8' : (v == false ? 'US-ASCII' : nil))
      when 'encoding' then return(v.is_a?(RxStr) ? v.bytes.dup.force_encoding('UTF-8') : nil)
      end
    end
    nil
  end

  ENCODING_IVARS = %w[E encoding].freeze

  # Comillas legibles sin depender del locale (inspect escapa las tildes en consolas no UTF-8)
  def self.quote(s)
    body = s.gsub(/[\\"]/) { |m| "\\#{m}" }.gsub(/[\x00-\x1f\x7f]/) { |m| m.inspect[1..-2] }
    "\"#{body}\""
  end

  # Clave de "internado" de simbolos (mismo nombre + misma codificacion)
  def self.sym_key(bytes, ivars)
    return 'p:'.b + bytes if ivars.nil?
    return nil unless ivars.size == 1
    k, v = ivars[0]
    case k.name
    when 'E'        then (v == true ? 'u:'.b : 'a:'.b) + bytes
    when 'encoding' then v.is_a?(RxStr) ? ('e:'.b + v.bytes + ':'.b + bytes) : nil
    end
  end

  # Tipo "logico" de un valor, usado para mostrar e inferir
  def self.type_desc(v)
    case v
    when nil          then 'nil'
    when true, false  then 'bool'
    when Integer, RxBig then 'int'
    when RxFloat      then 'float'
    when RxStr        then 'str'
    when RxSym        then 'sym'
    when RxArr        then 'array'
    when RxHash       then 'hash'
    when RxRegexp     then 'regexp'
    when RxClassRef   then (v.kind == 'c' ? 'class' : 'module')
    when *CLASSY      then "obj:#{v.class_name}"
    else 'desconocido'
    end
  end

  # Copia profunda de un subarbol (conserva enlaces internos, cicla bien)
  def self.deep_clone(v, map = {}.compare_by_identity)
    return v if v.nil? || v == true || v == false || v.is_a?(Integer) || v.is_a?(RxSym)
    return map[v] if map.key?(v)
    c = v.dup
    map[v] = c
    c.ivars = v.ivars.map { |k, x| [k, deep_clone(x, map)] } if v.ivars
    c.extends = v.extends.dup if v.extends
    case c
    when RxStr, RxUDef then c.bytes = v.bytes.dup
    when RxArr         then c.items = v.items.map { |x| deep_clone(x, map) }
    when RxHash
      c.pairs = v.pairs.map { |k, x| [deep_clone(k, map), deep_clone(x, map)] }
      c.default = deep_clone(v.default, map) if v.has_default
    when RxObj, RxStruct then c.attrs = v.attrs.map { |k, x| [k, deep_clone(x, map)] }
    when RxUMarshal, RxData then c.data = deep_clone(v.data, map)
    end
    c
  end

  # ── Lector ───────────────────────────────────────────────────────────────
  class Reader
    attr_reader :pos

    def initialize(data, symtab)
      @s = data.b
      @pos = 0
      @symtab = symtab
    end

    def eof?; @pos >= @s.bytesize; end

    def read_stream
      major = byte
      minor = byte
      unless major == 4 && minor <= 8
        raise FormatError, format('version Marshal %d.%d no soportada (byte %d)', major, minor, @pos - 2)
      end
      @syms = []
      @objs = []
      [read_value(nil), [major, minor]]
    end

    private

    def byte
      b = @s.getbyte(@pos)
      raise FormatError, "fin de datos inesperado (byte #{@pos})" unless b
      @pos += 1
      b
    end

    def fail_at(msg); raise FormatError, "#{msg} (byte #{@pos})"; end

    def read_long
      c = byte
      c -= 256 if c > 127
      return 0 if c.zero?
      if c > 0
        return c - 5 if c > 4
        x = 0
        c.times { |i| x |= byte << (8 * i) }
        x
      else
        return c + 5 if c < -4
        x = -1
        (-c).times do |i|
          x &= ~(0xff << (8 * i))
          x |= byte << (8 * i)
        end
        x
      end
    end

    def read_bytes(n = nil)
      n = read_long if n.nil?
      fail_at("longitud invalida #{n}") if n < 0 || @pos + n > @s.bytesize
      str = @s.byteslice(@pos, n)
      @pos += n
      str
    end

    def read_count
      n = read_long
      fail_at("cantidad invalida #{n}") if n < 0 || n > @s.bytesize - @pos
      n
    end

    def intern(bytes, ivars)
      key = RxMarshal.sym_key(bytes, ivars)
      return RxSym.new(bytes, ivars) unless key
      @symtab[key] ||= RxSym.new(bytes, ivars)
    end

    def read_sym_real(with_ivars)
      bytes = read_bytes
      idx = @syms.size
      @syms << nil                         # se registra ANTES de leer sus ivars
      ivars = with_ivars ? read_ivars : nil
      @syms[idx] = intern(bytes, ivars)
    end

    def read_symbol_any
      t = byte
      case t
      when 0x3a then read_sym_real(false)                                   # :
      when 0x3b then (i = read_long; @syms[i] || fail_at("simbolo ;#{i} invalido"))
      when 0x49                                                             # I:
        fail_at('se esperaba simbolo tras I') unless byte == 0x3a
        read_sym_real(true)
      else fail_at("se esperaba un simbolo y llego #{t.chr.inspect}")
      end
    end

    def read_ivars
      Array.new(read_count) { [read_symbol_any, read_value(nil)] }
    end

    def register(node)
      @objs << node
      node
    end

    def read_value(holder)
      t = byte
      case t
      when 0x30 then nil                                      # 0
      when 0x54 then true                                     # T
      when 0x46 then false                                    # F
      when 0x69 then read_long                                # i
      when 0x3a then read_sym_real(false)                     # :
      when 0x3b then (i = read_long; @syms[i] || fail_at("simbolo ;#{i} invalido"))
      when 0x40                                               # @
        i = read_long
        fail_at("enlace @#{i} invalido") unless i >= 0 && i < @objs.size
        @objs[i]
      when 0x49                                               # I
        if @s.getbyte(@pos) == 0x3a
          @pos += 1
          return read_sym_real(true)
        end
        h = [true]
        v = read_value(h)
        if h[0]
          fail_at('ivars sobre un valor inmediato') unless v.is_a?(Node)
          v.ivars = read_ivars
        end
        v
      when 0x65                                               # e (extend)
        mod = read_symbol_any
        v = read_value(nil)
        fail_at('extend sobre valor inmediato') unless v.is_a?(Node)
        (v.extends ||= []).unshift(mod)
        v
      when 0x43                                               # C (subclase de String/Array/Hash)
        klass = read_symbol_any
        v = read_value(nil)
        fail_at('C sobre valor inmediato') unless v.is_a?(Node)
        v.uclass = klass
        v
      when 0x22 then register(RxStr.new(read_bytes))          # "
      when 0x2f                                               # /
        node = RxRegexp.new(read_bytes, byte)
        if holder && holder[0]
          node.ivars = read_ivars
          node.inner_ivars = true
          holder[0] = false
        end
        register(node)
      when 0x66 then register(RxFloat.new(read_bytes))        # f
      when 0x6c                                               # l
        sign = byte.chr
        len = read_long
        fail_at('bignum invalido') if len < 0
        register(RxBig.new(sign, read_bytes(len * 2)))
      when 0x5b                                               # [
        n = read_count
        node = register(RxArr.new([]))
        n.times { node.items << read_value(nil) }
        node
      when 0x7b, 0x7d                                         # { }
        n = read_count
        node = register(RxHash.new([]))
        n.times { k = read_value(nil); node.pairs << [k, read_value(nil)] }
        if t == 0x7d
          node.has_default = true
          node.default = read_value(nil)
        end
        node
      when 0x6f, 0x53                                         # o S
        klass = read_symbol_any
        node = register(t == 0x6f ? RxObj.new(klass, []) : RxStruct.new(klass, []))
        n = read_count
        n.times { k = read_symbol_any; node.attrs << [k, read_value(nil)] }
        node
      when 0x75                                               # u
        klass = read_symbol_any
        node = RxUDef.new(klass, read_bytes)
        if holder && holder[0]
          node.ivars = read_ivars
          node.inner_ivars = true
          holder[0] = false
        end
        register(node)
      when 0x55, 0x64                                         # U d
        klass = read_symbol_any
        node = register(t == 0x55 ? RxUMarshal.new(klass, nil) : RxData.new(klass, nil))
        node.data = read_value(nil)
        node
      when 0x63, 0x6d, 0x4d                                   # c m M
        register(RxClassRef.new(t.chr, read_bytes))
      else
        fail_at(format('tipo Marshal desconocido %s (0x%02x)', t.chr.inspect, t))
      end
    end
  end

  # ── Escritor ─────────────────────────────────────────────────────────────
  class Writer
    attr_reader :out

    def initialize
      @out = String.new(encoding: BIN)
    end

    def write_stream(value, version = [4, 8])
      @out << version[0] << version[1]
      @syms = {}.compare_by_identity
      @objs = {}.compare_by_identity
      @nobj = 0
      write_value(value)
      self
    end

    private

    def w_long(x)
      if x.zero?                 then @out << 0
      elsif x > 0 && x < 123     then @out << (x + 5)
      elsif x < 0 && x > -124    then @out << ((x - 5) & 0xff)
      else
        buf = []
        len = nil
        4.times do
          buf << (x & 0xff)
          x >>= 8
          if x.zero?     then len = buf.size;  break
          elsif x == -1  then len = -buf.size; break
          end
        end
        raise FormatError, 'entero demasiado grande para w_long' unless len
        @out << (len & 0xff)
        buf.each { |b| @out << b }
      end
    end

    def w_bytes(s)
      w_long(s.bytesize)
      @out << (s.encoding == BIN ? s : s.b)
    end

    def write_symbol(sym)
      if (i = @syms[sym])
        @out << 0x3b
        w_long(i)
        return
      end
      @out << 0x49 if sym.ivars
      @out << 0x3a
      w_bytes(sym.bytes)
      @syms[sym] = @syms.size
      write_ivar_list(sym.ivars) if sym.ivars
    end

    def write_ivar_list(list)
      w_long(list.size)
      list.each { |k, v| write_symbol(k); write_value(v) }
    end

    def register(node)
      @objs[node] = @nobj
      @nobj += 1
    end

    def write_value(v)
      case v
      when nil   then @out << 0x30
      when true  then @out << 0x54
      when false then @out << 0x46
      when Integer
        if v >= -0x40000000 && v < 0x40000000
          @out << 0x69
          w_long(v)
        else
          @nobj += 1                       # Ruby registra el Bignum temporal
          write_big_int(v)
        end
      when RxSym  then write_symbol(v)
      when Node   then write_node(v)
      when Float  then write_node(RxFloat.from_f(v))
      else raise FormatError, "valor no serializable: #{v.class}"
      end
    end

    def write_big_int(v)
      @out << 0x6c << (v < 0 ? 0x2d : 0x2b)
      x = v.abs
      bytes = []
      while x > 0
        bytes << (x & 0xff)
        x >>= 8
      end
      bytes << 0 if bytes.size.odd?
      w_long(bytes.size / 2)
      bytes.each { |b| @out << b }
    end

    def write_prefix(n)
      @out << 0x49 if n.ivars
      n.extends.each { |m| @out << 0x65; write_symbol(m) } if n.extends
      if n.uclass
        @out << 0x43
        write_symbol(n.uclass)
      end
    end

    def write_ivars(n)
      write_ivar_list(n.ivars) if n.ivars
    end

    def write_node(n)
      if (i = @objs[n])
        @out << 0x40
        w_long(i)
        return
      end
      case n
      when RxStr
        register(n); write_prefix(n); @out << 0x22; w_bytes(n.bytes); write_ivars(n)
      when RxFloat
        register(n); write_prefix(n); @out << 0x66; w_bytes(n.raw); write_ivars(n)
      when RxBig
        register(n); write_prefix(n); @out << 0x6c << n.sign.ord
        w_long(n.data.bytesize / 2); @out << n.data; write_ivars(n)
      when RxArr
        register(n); write_prefix(n); @out << 0x5b
        w_long(n.items.size)
        n.items.each { |x| write_value(x) }
        write_ivars(n)
      when RxHash
        register(n); write_prefix(n); @out << (n.has_default ? 0x7d : 0x7b)
        w_long(n.pairs.size)
        n.pairs.each { |k, x| write_value(k); write_value(x) }
        write_value(n.default) if n.has_default
        write_ivars(n)
      when RxObj, RxStruct
        register(n); write_prefix(n); @out << (n.is_a?(RxObj) ? 0x6f : 0x53)
        write_symbol(n.klass)
        w_long(n.attrs.size)
        n.attrs.each { |k, x| write_symbol(k); write_value(x) }
        write_ivars(n)
      when RxUMarshal, RxData
        register(n); write_prefix(n); @out << (n.is_a?(RxUMarshal) ? 0x55 : 0x64)
        write_symbol(n.klass); write_value(n.data); write_ivars(n)
      when RxClassRef
        register(n); write_prefix(n); @out << n.kind.ord; w_bytes(n.name_bytes); write_ivars(n)
      when RxRegexp
        write_prefix(n); @out << 0x2f; w_bytes(n.source); @out << n.options
        if n.inner_ivars then write_ivars(n); register(n) else register(n); write_ivars(n) end
      when RxUDef
        write_prefix(n); @out << 0x75; write_symbol(n.klass); w_bytes(n.bytes)
        if n.inner_ivars then write_ivars(n); register(n) else register(n); write_ivars(n) end
      else
        raise FormatError, "nodo desconocido #{n.class}"
      end
    end
  end
end

# ──────────────────────────────────────────────────────────────────────────────
# Documento: uno o varios objetos Marshal seguidos (+ zlib opcional)
# ──────────────────────────────────────────────────────────────────────────────
class RxDocument
  include RxMarshal

  attr_reader :roots, :versions, :warnings, :symtab
  attr_accessor :trailing, :wrapper, :zlib_level, :inner_bytes, :string_style

  def initialize
    @roots = []
    @versions = []
    @warnings = []
    @symtab = {}
    @trailing = nil
    @wrapper = :none
    @zlib_level = Zlib::DEFAULT_COMPRESSION
    @string_style = :utf8
  end

  def self.parse(raw)
    doc = new
    data = raw.b
    b0 = data.getbyte(0)
    b1 = data.getbyte(1)
    if b0 == 0x78 && b1 && ((b0 << 8) | b1) % 31 == 0
      begin
        inflated = Zlib::Inflate.inflate(data)
        if inflated.getbyte(0) == 4
          doc.wrapper = :zlib
          doc.zlib_level = [1, 5, 6, 9][b1 >> 6]
          data = inflated.b
        end
      rescue Zlib::Error
        nil
      end
    end
    unless data.getbyte(0) == 4 && data.getbyte(1).to_i <= 8
      head = data.byteslice(0, 8).to_s.unpack1('H*').scan(/../).join(' ')
      raise RxMarshal::FormatError,
            "no parece un archivo Marshal de Ruby (primeros bytes: #{head}). ¿Esta cifrado o comprimido?"
    end
    doc.inner_bytes = data
    reader = RxMarshal::Reader.new(data, doc.symtab)
    until reader.eof?
      start = reader.pos
      unless data.getbyte(start) == 4 && data.getbyte(start + 1).to_i <= 8
        doc.trailing = data.byteslice(start, data.bytesize - start)
        doc.warnings << "Hay #{doc.trailing.bytesize} bytes al final que no son Marshal; se conservan tal cual."
        break
      end
      begin
        value, version = reader.read_stream
        doc.roots << value
        doc.versions << version
      rescue RxMarshal::FormatError => e
        raise if doc.roots.empty?
        doc.trailing = data.byteslice(start, data.bytesize - start)
        doc.warnings << "El objeto ##{doc.roots.size} no se pudo leer (#{e.message}); " \
                        "sus #{doc.trailing.bytesize} bytes se conservan tal cual y no se pueden editar."
        break
      end
    end
    doc
  end

  def to_bytes
    w = RxMarshal::Writer.new
    @roots.each_with_index { |r, i| w.write_stream(r, @versions[i] || [4, 8]) }
    w.out << @trailing if @trailing
    w.out
  end

  def to_file_bytes
    bytes = to_bytes
    @wrapper == :zlib ? Zlib::Deflate.deflate(bytes, @zlib_level) : bytes
  end

  # Primer byte distinto entre la reconstruccion y el original (nil = identico)
  def roundtrip_diff
    out = to_bytes
    orig = @inner_bytes
    return nil if out == orig
    n = [out.bytesize, orig.bytesize].min
    i = 0
    i += 1 while i < n && out.getbyte(i) == orig.getbyte(i)
    i
  end

  # Simbolo (internado) a partir de un nombre UTF-8
  def sym(name)
    bytes = name.to_s.b
    ivars = nil
    ivars = [[sym('E'), true]] if !name.to_s.ascii_only? && @string_style == :utf8
    key = RxMarshal.sym_key(bytes, ivars)
    @symtab[key] ||= RxMarshal::RxSym.new(bytes, ivars)
  end

  # Crea un String nuevo con el mismo "estilo" de codificacion que el archivo
  def new_string(text, like: nil)
    node = RxMarshal::RxStr.new(''.b)
    if like.is_a?(RxMarshal::RxStr)
      node.ivars = like.ivars.map { |k, v| [k, v] } if like.ivars
    elsif @string_style == :utf8
      node.ivars = [[sym('E'), true]]
    end
    set_text(node, text)
  end

  def set_text(node, text)
    enc = node.encoding_name
    if enc == 'US-ASCII' && !text.ascii_only?
      node.ivars.each { |pair| pair[1] = true if pair[0].name == 'E' }
      enc = 'UTF-8'
    end
    node.bytes = if enc.nil? || %w[UTF-8 US-ASCII].include?(enc)
                   text.encode('UTF-8').b
                 else
                   text.encode(enc).b
                 end
    node
  end
end
# ──────────────────────────────────────────────────────────────────────────────
# RECOLECCION DE CAMPOS + ESTADISTICAS DE TIPOS
#
# Cada campo editable ("hoja") recuerda donde vive (contenedor + indice) y
# unas "claves de ranura" que describen QUE es, independiente de la instancia:
#   Pokemon#@item            ivar @item de cualquier objeto Pokemon
#   Pokemon#@moves[]         cualquier elemento del array @moves
#   Pokemon#@moves[0]        el primer elemento (tuplas tipo [simbolo, cantidad])
#   Game_Variables#@data[]   cualquier variable del juego
#   $0{:player}              valor :player del hash raiz (Essentials v19+)
# Se cuentan los tipos vistos en cada clave para inferir los campos nil.
# ──────────────────────────────────────────────────────────────────────────────
Field = Struct.new(:path, :holder, :kind, :idx, :keys, :name_key, :owner) do
  def get
    case kind
    when :pair then holder[idx][1]
    when :item then holder[idx]
    when :data then holder.data
    end
  end

  def set(v)
    case kind
    when :pair then holder[idx][1] = v
    when :item then holder[idx] = v
    when :data then holder.data = v
    end
  end
end

class Collector
  include RxMarshal

  attr_reader :fields, :stats, :name_stats, :instances

  LEAF = [NilClass, TrueClass, FalseClass, Integer, RxSym, RxStr, RxFloat, RxBig].freeze

  def initialize(doc)
    @doc = doc
  end

  def run
    @fields = []
    @stats = Hash.new { |h, k| h[k] = Hash.new(0) }
    @name_stats = Hash.new { |h, k| h[k] = Hash.new { |h2, k2| h2[k2] = Hash.new(0) } }
    @instances = Hash.new { |h, k| h[k] = [] }
    seen = {}.compare_by_identity
    style = Hash.new(0)
    roots = @doc.roots
    multi = roots.size > 1
    stack = []
    (roots.size - 1).downto(0) do |i|
      stack << [roots, :item, i, multi ? "$#{i}" : '', ["$#{i}"], nil, nil]
    end
    until stack.empty?
      slot = stack.pop
      holder, kind, idx, path, keys, name_key, owner = slot
      v = case kind
          when :pair then holder[idx][1]
          when :item then holder[idx]
          else holder.data
          end
      t = RxMarshal.type_desc(v)
      keys.each { |k| @stats[k][t] += 1 }
      @name_stats[name_key][keys.last][t] += 1 if name_key
      if LEAF.any? { |c| v.is_a?(c) }
        @fields << Field.new(path, holder, kind, idx, keys, name_key, owner)
        if v.is_a?(RxStr)
          style[v.ivars.nil? ? :raw : (RxMarshal.encoding_from_ivars(v.ivars) == 'UTF-8' ? :utf8 : :other)] += 1
        end
        next
      end
      next unless v.is_a?(Node) && !seen[v]
      seen[v] = true
      kids = children(v, path, keys, name_key, owner)
      kids.reverse_each { |k| stack << k }
    end
    @doc.string_style = style[:raw] > style[:utf8] ? :raw : :utf8
    self
  end

  def nil_fields
    @fields.select { |f| f.get.nil? }
  end

  private

  def children(v, path, keys, name_key, owner)
    base = keys.last
    out = []
    case v
    when RxObj, RxStruct
      cls = v.class_name
      note_instance(cls, v, path)
      v.attrs.each_with_index do |(k, _), j|
        nm = k.name
        out << [v.attrs, :pair, j, path + attr_path(nm), ["#{cls}##{nm}"], nm.sub(/\A@/, ''), cls]
      end
    when RxUMarshal, RxData
      cls = v.class_name
      note_instance(cls, v, path)
      out << [v, :data, nil, "#{path}<data>", ["#{cls}#<data>"], nil, cls]
    when RxUDef
      note_instance(v.class_name, v, path)
    when RxArr
      v.items.each_index do |i|
        ks = i < 16 ? ["#{base}[#{i}]", "#{base}[]"] : ["#{base}[]"]
        out << [v.items, :item, i, "#{path}[#{i}]", ks, name_key && "#{name_key}[]", owner]
      end
    when RxHash
      v.pairs.each_with_index do |(k, _), j|
        kr = key_repr(k)
        ks = kr ? ["#{base}{#{kr}}", "#{base}{}"] : ["#{base}{}"]
        out << [v.pairs, :pair, j, path + key_path(k), ks, name_key && "#{name_key}{}", owner]
      end
    end
    if v.ivars && (v.is_a?(RxArr) || v.is_a?(RxHash))
      v.ivars.each_with_index do |(k, _), j|
        next if RxMarshal::ENCODING_IVARS.include?(k.name)
        out << [v.ivars, :pair, j, path + attr_path(k.name), ["#{base}#{attr_path(k.name)}"], nil, owner]
      end
    end
    out
  end

  def note_instance(cls, node, path)
    list = @instances[cls]
    list << [node, path] if list.size < 12
  end

  def attr_path(name)
    name.start_with?('@') ? name : ".#{name}"
  end

  def key_repr(k)
    case k
    when RxSym   then ":#{k.name}"
    when RxStr   then (t = k.text).bytesize <= 40 ? RxMarshal.quote(t) : nil
    when Integer then k.to_s
    end
  end

  def key_path(k)
    case k
    when RxSym   then ".#{k.name}"
    when RxStr   then "[#{RxMarshal.quote(k.text[0, 30])}]"
    when Integer then "{#{k}}"
    when nil, true, false then "{#{k.inspect}}"
    else "{#{RxMarshal.type_desc(k)}}"
    end
  end
end

# ──────────────────────────────────────────────────────────────────────────────
# ANALISIS ESTATICO DE LOS SCRIPTS DEL JUEGO
#
# Lee Scripts.rxdata / PluginScripts.rxdata (codigo zlib dentro de Marshal) o
# carpetas con .rb, y con el parser de Ruby (Ripper) busca pistas de tipo:
#   @nivel = 5 / @nombre = "" / @item = :POTION / @moves = []   (literales)
#   @x = Clase.new(...) / Time.now / valor.to_i / a < b / !algo  (expresiones)
#   # @return [Integer, nil]  sobre attr_accessor o getters     (YARD)
#   # @param value [String]   + @nombre = value                  (YARD)
#   validate id => Integer    + @id = id                         (Essentials)
#   def initialize(x, activo = true) + @activo = activo          (por defecto)
#   case @x when :FOO / @x == 3 / @lista.push(:A)                (usos)
# Tambien registra herencia (class A < B) para aprovechar pistas de la madre.
# ──────────────────────────────────────────────────────────────────────────────
class ScriptIndex
  Hint = Struct.new(:type, :strength, :where, :how, :cls)
  MAX_CLASS_HINTS = 40
  MAX_NAME_HINTS = 120
  EMPTY = [].freeze

  attr_reader :files, :errors, :hint_total, :fallback_files, :roots_used

  def initialize
    @class_hints = Hash.new { |h, k| h[k] = [] }
    @name_hints = Hash.new { |h, k| h[k] = [] }
    @superclass = {}
    @classes = {}
    @digests = {}
    @resolve_memo = {}
    @files = 0
    @fallback_files = 0
    @hint_total = 0
    @errors = []
    @roots_used = []
  end

  def empty?; @files.zero?; end

  # ---- localizacion de scripts ------------------------------------------------
  def self.game_root?(dir)
    File.file?(File.join(dir, 'Game.ini')) || File.file?(File.join(dir, 'Data', 'Scripts.rxdata'))
  end

  def self.game_script_paths(root)
    paths = []
    ini = File.join(root, 'Game.ini')
    if File.file?(ini)
      File.binread(ini).each_line do |l|
        next unless l =~ /\AScripts\s*=\s*(.+?)\s*\z/i
        p = File.join(root, Regexp.last_match(1).tr('\\', '/'))
        paths << p if File.file?(p)
      end
    end
    %w[Data/Scripts.rxdata Data/PluginScripts.rxdata].each do |r|
      p = File.join(root, r)
      paths << p if File.file?(p)
    end
    %w[Data/Scripts Plugins].each do |r|
      p = File.join(root, r)
      paths << p if File.directory?(p)
    end
    paths.uniq { |p| File.expand_path(p).downcase }
  end

  def self.autodetect(save_path)
    dirs = []
    d = File.dirname(File.expand_path(save_path))
    4.times do
      dirs << d
      parent = File.dirname(d)
      break if parent == d
      d = parent
    end
    dirs << Dir.pwd
    dirs.uniq.find { |x| game_root?(x) }
  end

  def add_path(path)
    path = path.to_s
    if File.directory?(path)
      if ScriptIndex.game_root?(path)
        @roots_used << path
        ScriptIndex.game_script_paths(path).each { |p| add_path(p) }
      else
        Dir.glob('**/*.rb', base: path).sort.each { |f| add_rb(File.join(path, f)) }
      end
    elsif File.file?(path)
      path =~ /\.rxdata\z/i ? add_rxdata(path) : add_rb(path)
    else
      @errors << "no existe: #{path}"
    end
  end

  def add_rb(file)
    add_source(File.binread(file), File.basename(file))
  rescue SystemCallError => e
    @errors << "#{file}: #{e.message}"
  end

  def add_rxdata(file)
    doc = RxDocument.parse(File.binread(file))
    found = 0
    stack = doc.roots.dup
    seen = {}.compare_by_identity
    until stack.empty?
      v = stack.pop
      next unless v.is_a?(RxMarshal::Node) && !seen[v]
      seen[v] = true
      case v
      when RxMarshal::RxArr
        label = nil
        codes = []
        v.items.each do |it|
          next unless it.is_a?(RxMarshal::RxStr)
          if it.bytes.getbyte(0) == 0x78 && (code = (Zlib::Inflate.inflate(it.bytes) rescue nil))
            codes << code
          elsif label.nil? && it.bytes.bytesize < 300
            label = it.text.split(%r{[\\/]}).last
          end
        end
        codes.each do |c|
          add_source(c, "#{File.basename(file)}[#{label || '?'}]")
          found += 1
        end
        v.items.each { |it| stack << it }
      when RxMarshal::RxHash then v.pairs.each { |k, x| stack << k << x }
      when RxMarshal::RxObj, RxMarshal::RxStruct then v.attrs.each { |_, x| stack << x }
      when RxMarshal::RxUMarshal, RxMarshal::RxData then stack << v.data
      end
    end
    @errors << "#{file}: no contiene scripts comprimidos" if found.zero?
  rescue RxMarshal::FormatError, SystemCallError => e
    @errors << "#{file}: #{e.message}"
  end

  def add_source(code, label)
    code = code.dup.force_encoding('UTF-8')
    code = code.scrub('?') unless code.valid_encoding?
    code = code.sub(/\A\uFEFF/, '')
    digest = [code.bytesize, code.hash]
    return if @digests[digest]
    @digests[digest] = true
    @files += 1
    sexp = nil
    if defined?(Ripper)
      begin
        sexp = Ripper.sexp(code)
      rescue StandardError
        sexp = nil
      end
    end
    if sexp
      begin
        ScriptWalker.new(self, label, code.lines).run(sexp)
        return
      rescue SystemStackError, StandardError
        nil
      end
    end
    @fallback_files += 1
    regex_fallback(code, label)
  end

  # ---- registro ---------------------------------------------------------------
  def add_class(full, sup, nesting)
    @classes[full] = true
    @superclass[full] ||= [sup, nesting] if sup
  end

  def add_hint(cls, key, type, strength, where, how)
    list = @class_hints["#{cls}##{key}"]
    list << Hint.new(type, strength, where, how, cls) if list.size < MAX_CLASS_HINTS
    nl = @name_hints[key.sub(/\A@/, '')]
    nl << Hint.new(type, strength, where, how, cls) if nl.size < MAX_NAME_HINTS
    @hint_total += 1
  end

  def add_name_hint(name, type, strength, where, how, cls)
    nl = @name_hints[name]
    nl << Hint.new(type, strength, where, how, cls) if nl.size < MAX_NAME_HINTS
    @hint_total += 1
  end

  # ---- consultas ----------------------------------------------------------------
  def resolve_const(cname, nesting)
    @resolve_memo[[cname, nesting]] ||= begin
      cands = nesting.reverse.map { |ns| "#{ns}::#{cname}" }
      cands.find { |c| @classes.key?(c) } || cname
    end
  end

  def type_of(hint)
    t = hint.type
    t.is_a?(Array) ? "obj:#{resolve_const(t[0], t[1])}" : t
  end

  def ancestors(cls)
    out = [cls]
    cur = cls
    10.times do
      s = @superclass[cur]
      break unless s
      sup = resolve_const(s[0], s[1])
      break if out.include?(sup)
      out << sup
      cur = sup
    end
    out
  end

  def class_hints(cls, rest)
    ancestors(cls).flat_map { |a| @class_hints.fetch("#{a}##{rest}", EMPTY) }
  end

  def name_hints(name_key)
    @name_hints.fetch(name_key, EMPTY)
  end

  private

  def regex_fallback(code, label)
    cls = nil
    code.each_line.with_index(1) do |l, ln|
      if l =~ /\A\s*class\s+([A-Z][\w:]*)/
        cls = Regexp.last_match(1)
        @classes[cls] = true
      elsif cls && l =~ /(@[A-Za-z_]\w*)\s*(?:\|\|)?=(?!=)\s*(.+)$/
        iv = Regexp.last_match(1)
        val = Regexp.last_match(2).strip
        t = case val
            when /\A-?\d+(\s|#|\z|\))/     then 'int'
            when /\A-?\d+\.\d+/             then 'float'
            when /\A["']/                   then 'str'
            when /\A:[A-Za-z_]/             then 'sym'
            when /\A(true|false)\b/         then 'bool'
            when /\A\[/                     then 'array'
            when /\A\{/                     then 'hash'
            when /\A([A-Z][\w:]*)\.new\b/   then [Regexp.last_match(1), []]
            end
        add_hint(cls, iv, t, 2.0, "#{label}:#{ln}", 'literal (analisis simple)') if t
      end
    end
  end
end

class ScriptWalker
  Ctx = Struct.new(:nesting, :cls, :meth)
  Meth = Struct.new(:name, :ptypes, :init)

  CONV = {
    'to_i' => 'int', 'to_int' => 'int', 'floor' => 'int', 'ceil' => 'int', 'round' => 'int',
    'length' => 'int', 'size' => 'int', 'count' => 'int', 'ord' => 'int',
    'to_f' => 'float',
    'to_s' => 'str', 'to_str' => 'str', 'inspect' => 'str', 'upcase' => 'str', 'downcase' => 'str',
    'capitalize' => 'str', 'strip' => 'str', 'chomp' => 'str', 'join' => 'str',
    'to_sym' => 'sym', 'intern' => 'sym',
    'to_a' => 'array', 'keys' => 'array', 'values' => 'array', 'map' => 'array', 'collect' => 'array',
    'select' => 'array', 'reject' => 'array', 'sort' => 'array', 'sort_by' => 'array', 'split' => 'array',
    'compact' => 'array', 'flatten' => 'array', 'uniq' => 'array',
    'to_h' => 'hash'
  }.freeze
  FUNCS = {
    'Integer' => 'int', 'Float' => 'float', 'String' => 'str', 'sprintf' => 'str', 'format' => 'str',
    '_INTL' => 'str', '_ISPRINTF' => 'str', '_MAPINTL' => 'str', 'Array' => 'array'
  }.freeze
  CMP_OPS = %i[== != === < > <= >=].freeze

  def initialize(index, label, lines)
    @index = index
    @label = label
    @lines = lines
  end

  def run(sexp)
    walk(sexp, Ctx.new([].freeze, nil, nil))
  end

  private

  def walk(node, ctx)
    return unless node.is_a?(Array)
    head = node[0]
    unless head.is_a?(Symbol)
      node.each { |c| walk(c, ctx) if c.is_a?(Array) }
      return
    end
    case head
    when :class
      name = const_name(node[1])
      return walk_children(node, ctx) unless name
      full = qualify(ctx.nesting, node[1], name)
      @index.add_class(full, node[2] && const_name(node[2]), ctx.nesting)
      walk(node[3], Ctx.new((ctx.nesting + [full]).freeze, full, nil))
    when :module
      name = const_name(node[1])
      return walk_children(node, ctx) unless name
      full = qualify(ctx.nesting, node[1], name)
      @index.add_class(full, nil, ctx.nesting)
      walk(node[2], Ctx.new((ctx.nesting + [full]).freeze, full, nil))
    when :sclass
      walk(node[2], Ctx.new(ctx.nesting, nil, nil))
    when :def
      walk_def(node, ctx)
    when :defs
      walk(node[5], Ctx.new(ctx.nesting, nil, nil))
    when :assign
      on_assign(node[1], node[2], ctx)
      walk_children(node, ctx)
    when :opassign
      on_opassign(node, ctx)
      walk_children(node, ctx)
    when :massign
      on_massign(node, ctx)
      walk_children(node, ctx)
    when :command, :method_add_arg, :command_call, :method_add_block
      on_call(node, ctx)
      walk_children(node, ctx)
    when :binary
      on_binary(node, ctx)
      walk_children(node, ctx)
    when :case
      on_case(node, ctx)
      walk_children(node, ctx)
    else
      walk_children(node, ctx) unless head.to_s.start_with?('@')
    end
  end

  def walk_children(node, ctx)
    i = 1
    while i < node.size
      c = node[i]
      walk(c, ctx) if c.is_a?(Array)
      i += 1
    end
  end

  # ---- utilidades de AST ------------------------------------------------------
  def tok_line(tok)
    tok.is_a?(Array) && tok[2].is_a?(Array) ? tok[2][0] : nil
  end

  def first_line(n, depth = 0)
    return nil unless n.is_a?(Array) && depth < 12
    return n[2][0] if n[0].is_a?(Symbol) && n[0].to_s.start_with?('@') && n[2].is_a?(Array)
    n.each do |c|
      l = first_line(c, depth + 1) if c.is_a?(Array)
      return l if l
    end
    nil
  end

  def const_name(n)
    return nil unless n.is_a?(Array)
    case n[0]
    when :const_ref, :top_const_ref, :var_ref, :top_const_field
      tok = n[1]
      tok.is_a?(Array) && tok[0] == :@const ? tok[1] : nil
    when :@const then n[1]
    when :const_path_ref, :const_path_field
      left = const_name(n[1])
      right = n[2].is_a?(Array) && n[2][0] == :@const ? n[2][1] : nil
      left && right ? "#{left}::#{right}" : nil
    end
  end

  def qualify(nesting, cpath, name)
    return name if cpath[0] == :top_const_ref || nesting.empty?
    "#{nesting.last}::#{name}"
  end

  def args_list(n)
    return [] unless n.is_a?(Array)
    case n[0]
    when :args_add_block, :arg_paren then args_list(n[1])
    when :args_add_star then []
    when Symbol then [n]
    else n.select { |x| x.is_a?(Array) }
    end
  end

  def ident_str(tok)
    tok.is_a?(Array) && %i[@ident @const @kw].include?(tok[0]) ? tok[1] : nil
  end

  def ivar_of(n)
    n.is_a?(Array) && n[0] == :var_ref && n[1].is_a?(Array) && n[1][0] == :@ivar ? n[1][1] : nil
  end

  def call_parts(n)
    return [nil, nil, [], nil] unless n.is_a?(Array)
    case n[0]
    when :method_add_arg
      r, m, _a, b = call_parts(n[1])
      [r, m, args_list(n[2]), b]
    when :method_add_block
      r, m, a, _b = call_parts(n[1])
      [r, m, a, n[2]]
    when :call      then [n[1], ident_str(n[3]), [], nil]
    when :command_call then [n[1], ident_str(n[3]), args_list(n[4]), nil]
    when :fcall, :vcall then [nil, ident_str(n[1]), [], nil]
    when :command   then [nil, ident_str(n[1]), args_list(n[2]), nil]
    else [nil, nil, [], nil]
    end
  end

  def attr_call_name(n)
    return nil unless n.is_a?(Array) && n[0] == :call
    ident_str(n[3])
  end

  def symbol_name(n)
    return nil unless n.is_a?(Array)
    case n[0]
    when :symbol_literal
      inner = n[1]
      inner = inner[1] if inner.is_a?(Array) && inner[0] == :symbol
      ident_str(inner) || (inner.is_a?(Array) && inner[0] == :@ivar ? inner[1] : nil)
    when :dyna_symbol
      parts = n[1].is_a?(Array) && n[1][0] == :string_content ? n[1][1..-1] : n[1]
      parts.is_a?(Array) && parts.size == 1 && parts[0].is_a?(Array) && parts[0][0] == :@tstring_content ? parts[0][1] : nil
    end
  end

  def literal_key(n)
    return nil unless n.is_a?(Array)
    case n[0]
    when :symbol_literal, :dyna_symbol
      (s = symbol_name(n)) ? ":#{s}" : nil
    when :@int then n[1] =~ /\A\d+\z/ ? n[1] : nil
    when :string_literal
      c = n[1]
      if c.is_a?(Array) && c[0] == :string_content && c.size == 2 && c[1].is_a?(Array) && c[1][0] == :@tstring_content
        RxMarshal.quote(c[1][1])
      elsif c.is_a?(Array) && c[0] == :string_content && c.size == 1
        '""'
      end
    end
  end

  def literal_type(n)
    return nil unless n.is_a?(Array)
    case n[0]
    when :@int then { t: 'int' }
    when :@float then { t: 'float' }
    when :string_literal, :@CHAR then { t: 'str' }
    when :symbol_literal, :dyna_symbol then { t: 'sym' }
    when :var_ref
      %w[true false].include?(ident_str(n[1])) && n[1][0] == :@kw ? { t: 'bool' } : nil
    end
  end

  def ty(t, s, how)
    { t: t, s: s, how: how }
  end

  def lit_strength(ctx)
    ctx.meth && ctx.meth.init ? 3.0 : 2.7
  end

  def pos_factor(i)
    i.zero? ? 1.0 : 0.45
  end

  # ---- comentarios YARD -------------------------------------------------------------
  def doc_block(line)
    return [] unless line
    out = []
    i = line - 2
    while i >= 0
      l = @lines[i]
      break unless l =~ /\A\s*#(.*)/
      out.unshift(Regexp.last_match(1))
      i -= 1
    end
    out
  end

  def yard_params(doc)
    h = {}
    doc.each do |l|
      if l =~ /@param\s+\[([^\]]+)\]\s+(\w+)/
        h[Regexp.last_match(2)] = yard_list(Regexp.last_match(1))
      elsif l =~ /@param\s+(\w+)\s+\[([^\]]+)\]/
        h[Regexp.last_match(1)] = yard_list(Regexp.last_match(2))
      end
    end
    h
  end

  def yard_return(doc)
    doc.each do |l|
      return yard_list(Regexp.last_match(1)) if l =~ /@return\s+\[([^\]]+)\]/
    end
    nil
  end

  def split_top(s)
    parts = []
    depth = 0
    cur = String.new
    prev = nil
    s.each_char do |ch|
      case ch
      when '<', '(', '{', '[' then depth += 1
      when ')', '}', ']' then depth -= 1
      when '>' then depth -= 1 unless prev == '='
      end
      if ch == ',' && depth.zero?
        parts << cur
        cur = String.new
      else
        cur << ch
      end
      prev = ch
    end
    parts << cur
    parts.map(&:strip).reject(&:empty?)
  end

  def yard_list(s)
    split_top(s.to_s).map { |x| yard_type(x) }.compact
  end

  def yard_type(s)
    s = s.strip
    case s
    when /\A(Integer|Fixnum|Bignum|Numeric)\z/ then { t: 'int' }
    when 'Float' then { t: 'float' }
    when 'String' then { t: 'str' }
    when 'Symbol' then { t: 'sym' }
    when /\A(Boolean|Bool|TrueClass|FalseClass|true|false)\z/i then { t: 'bool' }
    when /\A(nil|NilClass|void|Object|self|Proc)\z/i then nil
    when /\AArray(?:<(.+)>|\((.+)\))?\z/m
      inner = Regexp.last_match(1)
      tup = Regexp.last_match(2)
      t = { t: 'array' }
      t[:elem] = yard_list(inner) if inner
      t[:tuple] = split_top(tup).map { |x| [yard_type(x)].compact } if tup
      t
    when /\AHash(?:\{(.+)\}|<(.+)>)?\z/m
      a = Regexp.last_match(1)
      b = Regexp.last_match(2)
      t = { t: 'hash' }
      if a && a.include?('=>')
        t[:vals] = yard_list(a.split('=>', 2)[1])
      elsif b
        parts = split_top(b)
        t[:vals] = yard_list(parts[1]) if parts[1]
      end
      t
    when /\A(?:::)?([A-Z]\w*(?:::[A-Z]\w*)*)\z/ then { t: 'obj:', cname: Regexp.last_match(1) }
    end
  end

  def with_strength(types, base, how)
    types.each_with_index.map { |t, i| t.merge(s: base * pos_factor(i), how: how) }
  end

  # ---- registro de pistas ---------------------------------------------------------
  def record(ctx, key, t, strength, line, how, depth = 0)
    return unless ctx.cls && t && depth < 4
    tt = t[:t]
    return if tt.nil? || tt == 'nil'
    type = tt == 'obj:' ? [t[:cname], ctx.nesting] : tt
    @index.add_hint(ctx.cls, key, type, strength.round(2), "#{@label}:#{line}", how)
    s2 = strength * 0.95
    Array(t[:elem]).each { |e| record(ctx, "#{key}[]", e, s2, line, how, depth + 1) }
    Array(t[:tuple]).each_with_index do |ts, i|
      Array(ts).each { |e| record(ctx, "#{key}[#{i}]", e, s2, line, how, depth + 1) }
    end
    Array(t[:vals]).each { |e| record(ctx, "#{key}{}", e, s2, line, how, depth + 1) }
    (t[:keyed] || {}).each do |k, ts|
      Array(ts).each { |e| record(ctx, "#{key}{#{k}}", e, s2, line, how, depth + 1) }
    end
  end

  def name_hint(name, t, s, line, how, ctx)
    return unless name && t && t[:t] && t[:t] != 'nil'
    type = t[:t] == 'obj:' ? [t[:cname], ctx.nesting] : t[:t]
    @index.add_name_hint(name, type, s, "#{@label}:#{line}", how, ctx.cls)
  end

  # ---- nodos concretos --------------------------------------------------------
  def walk_def(node, ctx)
    name_tok = node[1]
    name = ident_str(name_tok).to_s
    line = tok_line(name_tok)
    params = node[2]
    params = params[1] if params.is_a?(Array) && params[0] == :paren
    doc = doc_block(line)
    ptypes = {}
    yard_params(doc).each { |pn, ts| ptypes[pn] = with_strength(ts, 2.8, "YARD @param #{pn}") }
    defaults_types(params, ctx).each { |pn, ts| ptypes[pn] ||= ts }
    inner = Ctx.new(ctx.nesting, ctx.cls, Meth.new(name, ptypes, name == 'initialize'))
    if ctx.cls && (iv = returned_ivar(node[3]))
      if (ret = yard_return(doc)) && no_params?(params)
        ret.each_with_index do |t, i|
          record(ctx, iv, t, 2.8 * pos_factor(i), line, "YARD @return de ##{name}")
        end
      end
      record(ctx, iv, { t: 'bool' }, 1.5, line, "metodo predicado ##{name}") if name.end_with?('?')
    end
    walk(node[3], inner)
  end

  def no_params?(p)
    return true unless p.is_a?(Array) && p[0] == :params
    p[1..-1].all? { |x| x.nil? || x == false || (x.is_a?(Array) && x.empty?) || x == 0 }
  end

  def defaults_types(p, ctx)
    out = {}
    return out unless p.is_a?(Array) && p[0] == :params
    plain = Ctx.new(ctx.nesting, ctx.cls, nil)
    [[p[2], false], [p[5], true]].each do |list, kw|
      next unless list.is_a?(Array)
      list.each do |pair|
        next unless pair.is_a?(Array) && pair[0].is_a?(Array) && pair[1].is_a?(Array)
        nm = pair[0][1].to_s
        nm = nm.chomp(':') if kw
        ts = rhs_types(pair[1], plain)
        out[nm] = ts.map { |x| x.merge(s: 2.0, how: "valor por defecto de #{nm}") } unless ts.empty?
      end
    end
    out
  end

  def returned_ivar(body)
    stmts = body.is_a?(Array) && body[0] == :bodystmt ? body[1] : body
    return nil unless stmts.is_a?(Array)
    last = stmts.reverse.find { |s| s.is_a?(Array) && s[0] != :void_stmt }
    return nil unless last
    return ivar_of(last) if last[0] == :var_ref
    if last[0] == :return
      a = args_list(last[1])
      return ivar_of(a[0]) if a.size == 1
    end
    nil
  end

  def on_assign(lhs, rhs, ctx)
    return unless lhs.is_a?(Array)
    case lhs[0]
    when :var_field
      tok = lhs[1]
      return unless ctx.cls && tok.is_a?(Array) && tok[0] == :@ivar
      rhs_types(rhs, ctx).each do |t|
        record(ctx, tok[1], t, t[:s] || lit_strength(ctx), tok_line(tok), t[:how] || 'asignacion')
      end
    when :aref_field
      iv = ivar_of(lhs[1])
      return unless ctx.cls && iv
      line = tok_line(lhs[1][1])
      keys = args_list(lhs[2])
      sfx = %w[[] {}]
      if keys.size == 1 && (kr = literal_key(keys[0]))
        sfx << "[#{kr}]" if kr =~ /\A\d+\z/
        sfx << "{#{kr}}"
      end
      rhs_types(rhs, ctx).each do |t|
        sfx.each { |s| record(ctx, iv + s, t, (t[:s] || lit_strength(ctx)) * 0.9, line, "#{iv}[...] = (#{t[:how]})") }
      end
    when :field
      nm = ident_str(lhs[3])
      return unless nm
      rhs_types(rhs, ctx).each do |t|
        name_hint(nm, t, 1.2, tok_line(lhs[3]), "obj.#{nm} = (#{t[:how]})", ctx)
      end
    end
  end

  def on_opassign(node, ctx)
    lhs = node[1]
    op = node[2].is_a?(Array) ? node[2][1] : node[2].to_s
    rhs = node[3]
    case op
    when '||=', '&&=' then on_assign(lhs, rhs, ctx)
    when '+=', '-=', '*=', '/=', '%=', '**=', '|=', '&=', '^=', '<<=', '>>='
      return unless lhs.is_a?(Array) && lhs[0] == :var_field && lhs[1].is_a?(Array) && lhs[1][0] == :@ivar && ctx.cls
      rhs_types(rhs, ctx).each do |t|
        next unless %w[int float str array].include?(t[:t])
        next if op != '+=' && %w[str array].include?(t[:t])
        record(ctx, lhs[1][1], { t: t[:t] }, 2.0, tok_line(lhs[1]), "operador #{op}")
      end
    end
  end

  def on_massign(node, ctx)
    targets = node[1]
    rhs = node[2]
    return unless targets.is_a?(Array) && rhs.is_a?(Array)
    targets = targets.select { |x| x.is_a?(Array) } unless targets[0].is_a?(Symbol)
    values = case rhs[0]
             when :mrhs_new_from_args then args_list(rhs[1]) + (rhs[2].is_a?(Array) ? [rhs[2]] : [])
             when :array then args_list(rhs[1])
             end
    return unless values
    targets.each_with_index { |tg, i| on_assign(tg, values[i], ctx) if values[i] }
  end

  def on_call(node, ctx)
    recv, meth, args, = call_parts(node)
    return unless meth
    if recv.nil?
      case meth
      when 'attr_accessor', 'attr_reader', 'attr_writer' then on_attr(node, meth, args, ctx)
      when 'validate' then on_validate(args, ctx)
      end
    elsif ctx.cls && (iv = ivar_of(recv)) && %w[push unshift append prepend].include?(meth) && !args.empty?
      line = tok_line(recv[1])
      record(ctx, iv, { t: 'array' }, 1.5, line, ".#{meth}")
      args.each do |a|
        rhs_types(a, ctx).each { |t| record(ctx, "#{iv}[]", t, 1.5, line, "#{iv}.#{meth}(#{t[:how]})") }
      end
    end
  end

  def on_attr(node, meth, args, ctx)
    return unless ctx.cls
    line = first_line(node)
    doc = doc_block(line)
    types = yard_return(doc)
    if types.nil? && meth != 'attr_reader'
      pv = yard_params(doc).values.first
      types = pv if pv
    end
    return unless types && !types.empty?
    args.each do |a|
      nm = symbol_name(a)
      next unless nm
      types.each_with_index do |t, i|
        record(ctx, "@#{nm}", t, 2.8 * pos_factor(i), line, "YARD sobre #{meth} :#{nm}")
      end
    end
  end

  def on_validate(args, ctx)
    return unless ctx.meth
    args.each do |a|
      next unless a.is_a?(Array)
      assocs = case a[0]
               when :bare_assoc_hash then a[1]
               when :hash then a[1].is_a?(Array) ? a[1][1] : nil
               end
      Array(assocs).each do |as|
        next unless as.is_a?(Array) && as[0] == :assoc_new
        pn = as[1].is_a?(Array) && as[1][0] == :var_ref ? ident_str(as[1][1]) : nil
        next unless pn
        consts = as[2].is_a?(Array) && as[2][0] == :array ? args_list(as[2][1]) : [as[2]]
        types = consts.map { |c| (cn = const_name(c)) ? yard_type(cn) : nil }.compact
        ctx.meth.ptypes[pn] = with_strength(types, 2.8, "validate #{pn} => ...") unless types.empty?
      end
    end
  end

  def on_binary(node, ctx)
    op = node[2]
    return unless CMP_OPS.include?(op)
    [[node[1], node[3]], [node[3], node[1]]].each do |a, b|
      lt = literal_type(b)
      next unless lt
      if ctx.cls && (iv = ivar_of(a))
        record(ctx, iv, lt, 1.5, tok_line(a[1]), "comparacion #{iv} #{op} literal")
      elsif (nm = attr_call_name(a))
        name_hint(nm, lt, 1.0, first_line(a), "comparacion .#{nm} #{op} literal", ctx)
      end
    end
  end

  def on_case(node, ctx)
    subj = node[1]
    iv = ivar_of(subj)
    nm = iv ? nil : attr_call_name(subj)
    return unless (iv && ctx.cls) || nm
    line = first_line(subj)
    w = node[2]
    guard = 0
    while w.is_a?(Array) && w[0] == :when && guard < 300
      args_list(w[1]).each do |c|
        lt = literal_type(c)
        next unless lt
        if iv
          record(ctx, iv, lt, 1.5, line, "case #{iv} when literal")
        else
          name_hint(nm, lt, 1.0, line, "case .#{nm} when literal", ctx)
        end
      end
      w = w[3]
      guard += 1
    end
  end

  # ---- tipo de una expresion ------------------------------------------------------
  def rhs_types(n, ctx, depth = 0)
    return [] unless n.is_a?(Array) && depth < 4
    ls = lit_strength(ctx)
    case n[0]
    when :@int then [ty('int', ls, 'literal entero')]
    when :@float then [ty('float', ls, 'literal float')]
    when :string_literal, :xstring_literal, :@CHAR, :string_concat then [ty('str', ls, 'literal string')]
    when :symbol_literal, :dyna_symbol then [ty('sym', ls, 'literal simbolo')]
    when :regexp_literal then [ty('regexp', ls, 'literal regexp')]
    when :dot2, :dot3 then [ty('obj:Range', ls, 'rango')]
    when :var_ref
      tok = n[1]
      return [] unless tok.is_a?(Array)
      case tok[0]
      when :@kw
        case tok[1]
        when 'true', 'false' then [ty('bool', ls, "literal #{tok[1]}")]
        when 'self' then ctx.cls ? [{ t: 'obj:', cname: ctx.cls, s: 2.0, how: 'self' }] : []
        else []
        end
      when :@ident
        pt = ctx.meth && ctx.meth.ptypes[tok[1]]
        pt ? pt.map(&:dup) : []
      else []
      end
    when :array
      t = ty('array', ls, 'literal array')
      elems = args_list(n[1])
      unless elems.empty?
        per = elems.first(8).map { |e| rhs_types(e, ctx, depth + 1) }
        flat = per.flatten.uniq { |x| [x[:t], x[:cname]] }
        t[:elem] = flat unless flat.empty?
        t[:tuple] = per if elems.size <= 8 && per.all? { |x| x.size <= 1 } && per.map { |x| x.first && x.first[:t] }.uniq.size > 1
      end
      [t]
    when :hash
      t = ty('hash', ls, 'literal hash')
      assocs = n[1].is_a?(Array) && n[1][0] == :assoclist_from_args ? n[1][1] : []
      vals = []
      keyed = {}
      Array(assocs).first(24).each do |as|
        next unless as.is_a?(Array) && as[0] == :assoc_new
        vt = rhs_types(as[2], ctx, depth + 1)
        vals.concat(vt)
        k = literal_key(as[1])
        keyed[k] = vt if k && !vt.empty?
      end
      vals = vals.uniq { |x| [x[:t], x[:cname]] }
      t[:vals] = vals unless vals.empty?
      t[:keyed] = keyed unless keyed.empty?
      [t]
    when :paren
      body = n[1]
      last = if body.is_a?(Array) && body[0].is_a?(Symbol) then body
             elsif body.is_a?(Array) then body.reverse.find { |x| x.is_a?(Array) && x[0] != :void_stmt }
             end
      rhs_types(last, ctx, depth + 1)
    when :ifop
      (rhs_types(n[2], ctx, depth + 1) + rhs_types(n[3], ctx, depth + 1)).each { |x| x[:s] = (x[:s] || ls) * 0.9 }
    when :unary
      case n[1]
      when :!, :not then [ty('bool', 2.5, 'negacion !')]
      when :-@, :+@ then rhs_types(n[2], ctx, depth + 1).select { |x| %w[int float].include?(x[:t]) }
      else []
      end
    when :binary then binary_types(n, ctx, depth)
    when :assign then rhs_types(n[2], ctx, depth + 1)
    when :call, :method_add_arg, :method_add_block, :command_call, :fcall, :vcall, :command
      call_types(n, ctx, depth)
    else []
    end
  end

  def binary_types(n, ctx, depth)
    op = n[2]
    if CMP_OPS.include?(op)
      [ty('bool', 2.5, "comparacion #{op}")]
    elsif %i[&& || and or].include?(op)
      rhs_types(n[1], ctx, depth + 1) + rhs_types(n[3], ctx, depth + 1)
    elsif %i[+ - * / % **].include?(op)
      l = rhs_types(n[1], ctx, depth + 1)
      r = rhs_types(n[3], ctx, depth + 1)
      ts = (l + r).map { |x| x[:t] }
      if op == :* && l.any? { |x| x[:t] == 'array' }
        l.select { |x| x[:t] == 'array' }.map { |x| x.merge(s: 2.7, how: '[...] * n') }
      elsif ts.include?('float') && (ts - %w[int float]).empty? then [ty('float', 2.0, "aritmetica #{op}")]
      elsif ts.include?('int') && (ts - %w[int]).empty? then [ty('int', 2.0, "aritmetica #{op}")]
      elsif op == :+ && ts.include?('str') then [ty('str', 2.0, 'concatenacion')]
      else []
      end
    elsif %i[& | ^ << >>].include?(op)
      ts = (rhs_types(n[1], ctx, depth + 1) + rhs_types(n[3], ctx, depth + 1)).map { |x| x[:t] }
      ts.include?('int') && (ts - %w[int]).empty? ? [ty('int', 2.0, "operacion #{op}")] : []
    else
      []
    end
  end

  def call_types(n, ctx, depth)
    recv, meth, args, block = call_parts(n)
    return [] unless meth
    if recv && (cname = const_name(recv))
      if meth == 'new'
        case cname
        when 'Array'
          t = ty('array', 2.8, 'Array.new')
          et = args[1] ? rhs_types(args[1], ctx, depth + 1) : block_types(block, ctx, depth)
          t[:elem] = et unless et.empty?
          return [t]
        when 'Hash'
          t = ty('hash', 2.8, 'Hash.new')
          vt = args[0] ? rhs_types(args[0], ctx, depth + 1) : []
          t[:vals] = vt unless vt.empty?
          return [t]
        when 'String' then return [ty('str', 2.8, 'String.new')]
        else return [{ t: 'obj:', cname: cname, s: 2.8, how: "#{cname}.new" }]
        end
      elsif cname == 'Time' && %w[now at local mktime gm utc].include?(meth)
        return [ty('obj:Time', 2.8, "Time.#{meth}")]
      end
    end
    if recv
      if meth == 'clamp' && !args.empty?
        lt = args.map { |a| literal_type(a) }.compact.map { |x| x[:t] }
        return [ty(lt.include?('float') ? 'float' : 'int', 2.0, '.clamp')] if (lt - %w[int float]).empty? && !lt.empty?
      end
      conv = CONV[meth]
      return [ty(conv, 2.0, ".#{meth}")] if conv && !(%w[round floor ceil].include?(meth) && !args.empty?)
      return [ty('bool', 1.8, ".#{meth}")] if meth.end_with?('?')
      return []
    end
    return [ty(args.empty? ? 'float' : 'int', 2.0, 'rand')] if meth == 'rand'
    (f = FUNCS[meth]) ? [ty(f, 2.0, "#{meth}()")] : []
  end

  def block_types(block, ctx, depth)
    return [] unless block.is_a?(Array)
    body = block[2]
    body = body[1] if body.is_a?(Array) && body[0] == :bodystmt
    return [] unless body.is_a?(Array)
    last = body.reverse.find { |x| x.is_a?(Array) && x[0] != :void_stmt }
    rhs_types(last, ctx, depth + 1)
  end
end

# ──────────────────────────────────────────────────────────────────────────────
# HEURISTICA POR NOMBRE (la evidencia mas debil; solo desempata)
# ──────────────────────────────────────────────────────────────────────────────
module NameHeuristics
  RULES = [
    [/\A(is|has|can|should|was|use|show|allow|enable|disable|need|must|hide)_?[a-z]/i, 'bool'],
    [/(\A|_)(enabled|disabled|visible|locked|shiny|obtained|seen|owned|active|done|finished|completed|cleared|valid|fainted|hidden|opened|unlocked|registered)\z/i, 'bool'],
    [/\A(id|index|idx|level|lvl|exp|hp|pp|money|coins|steps|count|amount|quantity|qty|size|width|height|total|points|score|happiness|form|frame|frames|timer|x|y|z|direction|opacity|volume|pitch|hue|turn|slot|offset|version|language)\z/i, 'int'],
    [/(_id|_count|_num|_index|_level|_steps|_frames|Id|ID|Count|Num|Index|Steps)\z/, 'int'],
    [/(\A|_)(name|nickname|title|text|message|msg|path|filename|graphic|description|desc|label)\z/i, 'str'],
    [/[a-z](Name|Text|Title|Message|Path|Graphic)\z/, 'str'],
    [/(\A|_)(zoom|scale|ratio|factor)(_[xy])?\z/i, 'float'],
    [/(\A|_)(list|queue|stack|history)\z/i, 'array']
  ].freeze

  def self.guess(name)
    return nil if name.nil? || name =~ /[\[\]{}]/
    RULES.each { |re, t| return t if name =~ re }
    nil
  end
end

# ──────────────────────────────────────────────────────────────────────────────
# ORACULO DE TIPOS: combina todas las evidencias y da candidatos con puntaje
# ──────────────────────────────────────────────────────────────────────────────
class TypeOracle
  Cand = Struct.new(:type, :score, :evidence)
  Result = Struct.new(:candidates, :confidence) do
    def best; candidates.first; end
  end

  # Nombres tan comunes que compararlos entre clases distintas solo mete ruido
  GENERIC_NAMES = %w[data value values list items item_list contents params parameters args info hash obj object
                     extra temp tmp h a b c x y z array elements entries table cache map].freeze

  def initialize(collector, scripts)
    @col = collector
    @scripts = scripts && !scripts.empty? ? scripts : nil
    @memo = {}
  end

  def reset!(collector)
    @col = collector
    @memo.clear
  end

  def infer(field)
    key = [field.keys, field.name_key, field.holder.object_id]
    @memo[key] ||= compute(field)
  end

  private

  def sample_factor(n)
    [0.55 + 0.15 * n, 1.0].min
  end

  def compute(field)
    scores = Hash.new(0.0)
    ev = Hash.new { |h, k| h[k] = [] }
    srcs = Hash.new { |h, k| h[k] = {} }
    add = lambda do |t, pts, msg|
      next if t.nil? || t == 'nil' || pts <= 0
      scores[t] += pts
      ev[t] << msg
      srcs[t][msg.split(':', 2).first] = true
    end

    # 1) La propia partida: misma ranura en otras instancias
    got_save = false
    field.keys.each_with_index do |k, i|
      dist = @col.stats.fetch(k, nil)
      next unless dist
      nonnil = dist.reject { |t, _| t == 'nil' }
      next if nonnil.empty?
      next if k.end_with?('{}') && nonnil.size >= 3   # hash tipo "registro": cada clave es distinta
      total = nonnil.values.sum
      base = (i.zero? && field.keys.size > 1 ? 3.2 : 3.0) * sample_factor(total)
      nonnil.sort_by { |_, c| -c }.each do |t, c|
        add.call(t, base * c / total, "partida: #{k} es #{t} en #{c} de #{total} valor(es) no-nil")
      end
      got_save = true
      break
    end

    # 2) Otros elementos del mismo array/hash (si no hubo nada mejor)
    unless got_save
      sib = sibling_dist(field)
      unless sib.empty?
        total = sib.values.sum
        sib.each { |t, c| add.call(t, 2.0 * sample_factor(total) * c / total, "partida: #{c} de #{total} elemento(s) vecinos son #{t}") }
      end
    end

    # 3) Scripts del juego, misma clase (y clases madre)
    anc = []
    if @scripts
      field.keys.each do |k|
        cls, rest = k.split('#', 2)
        next unless rest && !cls.start_with?('$')
        anc = @scripts.ancestors(cls)
        hints = @scripts.class_hints(cls, rest)
        next if hints.empty?
        hints.group_by { |h| @scripts.type_of(h) }.each do |t, hs|
          best = hs.max_by(&:strength)
          places = hs.map(&:where).uniq.size
          bonus = [0.15 * (places - 1), 0.6].min
          extra = places > 1 ? " (+#{places - 1} sitio(s) mas)" : ''
          add.call(t, best.strength + bonus, "scripts: #{best.how} en #{best.where}#{extra}")
        end
        break
      end
    end

    base_name = field.name_key.to_s.sub(/(\[\]|\{\})+\z/, '')
    generic = GENERIC_NAMES.include?(base_name.downcase)

    # 4) La partida: mismo nombre de variable en otras clases
    if field.name_key && !generic && @col.name_stats.key?(field.name_key)
      agg = Hash.new(0)
      @col.name_stats[field.name_key].each do |owner_key, dist|
        next if field.keys.include?(owner_key)
        dist.each { |t, c| agg[t] += c unless t == 'nil' }
      end
      unless agg.empty?
        total = agg.values.sum
        agg.each { |t, c| add.call(t, 1.5 * sample_factor(total) * c / total, "partida: '#{field.name_key}' en otras clases es #{t} (#{c}/#{total})") }
      end
    end

    # 5) Scripts: mismo nombre en otras clases / obj.nombre = ...
    if @scripts && field.name_key && !generic
      hints = @scripts.name_hints(field.name_key).reject { |h| anc.include?(h.cls) }
      hints.group_by { |h| @scripts.type_of(h) }.each do |t, hs|
        best = hs.max_by(&:strength)
        who = best.cls ? " (clase #{best.cls})" : ''
        add.call(t, [best.strength * 0.45, 1.3].min, "scripts: #{best.how} en #{best.where}#{who}")
      end
    end

    # 6) Nombre de la variable
    if (t = NameHeuristics.guess(field.name_key))
      add.call(t, 0.75, "heuristica: el nombre '#{field.name_key}' suele ser #{t}")
    end

    cands = scores.map { |t, s| Cand.new(t, s, ev[t]) }.sort_by { |c| -c.score }
    Result.new(cands, confidence(cands, srcs))
  end

  def sibling_dist(field)
    dist = Hash.new(0)
    case field.kind
    when :item
      return dist if field.keys.first.to_s.start_with?('$')   # las raices son heterogeneas
      field.holder.each_with_index do |v, i|
        next if i == field.idx || v.nil?
        dist[RxMarshal.type_desc(v)] += 1
      end
      dist.clear if dist.size >= 3
    when :pair
      return dist unless field.holder.first.is_a?(Array) && field.keys.last.to_s.end_with?('{}')
      field.holder.each_with_index do |(_, v), i|
        next if i == field.idx || v.nil?
        dist[RxMarshal.type_desc(v)] += 1
      end
      dist.clear if dist.size >= 3
    end
    dist
  end

  def confidence(cands, srcs)
    return nil if cands.empty?
    total = cands.sum(&:score)
    b = cands.first.score
    share = b / total
    both = srcs[cands.first.type].key?('partida') && srcs[cands.first.type].key?('scripts')
    if (b >= 2.5 && share >= 0.75) || (both && share >= 0.5) then :alta
    elsif b >= 1.4 && share >= 0.5 then :media
    else :baja
    end
  end
end

# ──────────────────────────────────────────────────────────────────────────────
# INTERFAZ
# ──────────────────────────────────────────────────────────────────────────────
module UI
  module_function

  TYPE_ALIASES = {
    'int' => 'int', 'entero' => 'int', 'integer' => 'int',
    'float' => 'float', 'decimal' => 'float',
    'str' => 'str', 'string' => 'str', 'texto' => 'str',
    'sym' => 'sym', 'symbol' => 'sym', 'simbolo' => 'sym',
    'bool' => 'bool', 'boolean' => 'bool',
    'nil' => 'nil'
  }.freeze
  EDITABLE = %w[int float str sym bool].freeze

  def read_line
    line = $stdin.gets
    return nil unless line
    line = line.chomp
    enc = line.encoding
    if [Encoding::UTF_8, Encoding::ASCII_8BIT, Encoding::US_ASCII].include?(enc) || !line.valid_encoding?
      utf = line.dup.force_encoding('UTF-8')
      line = utf.valid_encoding? ? utf : line.dup.force_encoding(enc).encode('UTF-8', invalid: :replace, undef: :replace)
    else
      line = line.encode('UTF-8', invalid: :replace, undef: :replace)   # p. ej. CP850 en la consola de Windows
    end
    line.strip
  end

  def ask(prompt)
    print "#{C::YELLOW}#{prompt}#{C::RESET}"
    read_line
  end

  def yes?(prompt)
    ans = ask(prompt)
    !ans.nil? && %w[s si sí y yes].include?(ans.downcase)
  end

  def title(text)
    puts "#{C::BOLD}#{C::CYAN}── #{text} #{'─' * [56 - text.length, 3].max}#{C::RESET}"
  end

  def display_value(v, max = 80)
    case v
    when nil   then "#{C::DIM}nil#{C::RESET}"
    when true  then "#{C::GREEN}true#{C::RESET}"
    when false then "#{C::RED}false#{C::RESET}"
    when Integer then "#{C::CYAN}#{v}#{C::RESET}"
    when RxMarshal::RxBig   then "#{C::CYAN}#{v.value}#{C::RESET}"
    when RxMarshal::RxFloat then "#{C::CYAN}#{v.value}#{C::RESET}"
    when RxMarshal::RxSym   then "#{C::MAGENTA}:#{v.name}#{C::RESET}"
    when RxMarshal::RxStr
      s = v.text
      s = "#{s[0, max]}..." if s.length > max
      "#{C::GREEN}#{RxMarshal.quote(s)}#{C::RESET}"
    when RxMarshal::RxArr  then "#{C::BLUE}[array con #{v.items.size} elemento(s)]#{C::RESET}"
    when RxMarshal::RxHash then "#{C::BLUE}{hash con #{v.pairs.size} par(es)}#{C::RESET}"
    when RxMarshal::Node   then "#{C::BLUE}#<#{RxMarshal.type_desc(v).sub('obj:', '')}>#{C::RESET}"
    else v.inspect
    end
  end

  def short_type(t)
    t.to_s.start_with?('obj:') ? 'obj' : t.to_s
  end

  def conf_color(conf)
    { alta: C::GREEN, media: C::YELLOW, baja: C::RED }[conf] || C::DIM
  end

  def tag_for(v, res)
    t = RxMarshal.type_desc(v)
    unless v.nil?
      color = case t
              when 'bool' then v ? C::GREEN : C::RED
              when 'int', 'float' then C::CYAN
              when 'str' then C::GREEN
              when 'sym' then C::MAGENTA
              else C::BLUE
              end
      return ["[#{t}]", color]
    end
    return ['[nil>?]', C::DIM] unless res && res.best
    ["[nil>#{short_type(res.best.type)}]", conf_color(res.confidence)]
  end

  def nil_hint(res)
    return "#{C::DIM}(tipo desconocido)#{C::RESET}" unless res && res.best
    "#{C::DIM}-> #{res.best.type.sub('obj:', '')} (#{res.confidence})#{C::RESET}"
  end

  def unquote(s)
    if s.size >= 2 && ((s.start_with?('"') && s.end_with?('"')) || (s.start_with?("'") && s.end_with?("'")))
      s[1..-2]
    else
      s
    end
  end

  def parse_as(type, text)
    case type
    when 'int'
      t = text.delete('_')
      raise 'No es un entero valido' unless t =~ /\A[-+]?\d+\z/
      t.to_i
    when 'float'
      case text.downcase
      when 'inf', '+inf', 'infinity' then Float::INFINITY
      when '-inf', '-infinity' then -Float::INFINITY
      when 'nan' then Float::NAN
      else
        begin
          Float(text.tr(',', '.'))
        rescue ArgumentError
          raise 'No es un float valido'
        end
      end
    when 'bool'
      case text.downcase
      when 'true', '1', 'si', 'sí', 's', 'yes', 'y', 'verdadero' then true
      when 'false', '0', 'no', 'n', 'falso' then false
      else raise 'Ingresa true o false (si/no)'
      end
    when 'str' then unquote(text)
    when 'sym'
      n = unquote(text.sub(/\A:/, ''))
      raise 'El simbolo no puede estar vacio' if n.empty?
      n
    when 'nil' then nil
    end
  end

  def guess_input_type(text)
    case text
    when /\A[-+]?\d+\z/ then 'int'
    when /\A[-+]?\d+[.,]\d+([eE][-+]?\d+)?\z/ then 'float'
    when /\A(true|false)\z/i then 'bool'
    when /\A:\S+\z/ then 'sym'
    else 'str'
    end
  end

  def build_value(doc, type, value, old)
    case type
    when 'float' then RxMarshal::RxFloat.from_f(value)
    when 'str'   then doc.new_string(value, like: old.is_a?(RxMarshal::RxStr) ? old : nil)
    when 'sym'   then doc.sym(value)
    else value # int, bool, nil
    end
  end

  def canon(v)
    case v
    when nil, true, false then v
    when Integer then [:int, v]
    when RxMarshal::RxBig then [:int, v.value]
    when RxMarshal::RxFloat then [:float, v.raw]
    when RxMarshal::RxStr then [:str, v.bytes, v.encoding_name]
    when RxMarshal::RxSym then [:sym, v.bytes]
    else [:obj, v.object_id]
    end
  end

  def same_value?(a, b)
    canon(a) == canon(b)
  end

  def type_match?(field, filter, oracle)
    v = field.get
    t = RxMarshal.type_desc(v)
    case filter
    when 'nil' then v.nil?
    when /\Anil:(.+)\z/
      want = Regexp.last_match(1).downcase
      return false unless v.nil?
      best = oracle.infer(field).best
      return best.nil? if want == '?'
      return false unless best
      bt = best.type.downcase
      bt == want || bt.sub('obj:', '') == want || (want == 'obj' && bt.start_with?('obj:'))
    when 'obj' then t.start_with?('obj:')
    else t == filter
    end
  end

  def show_inference(res, limit = 3, evidence_lines = 3)
    if res.nil? || res.best.nil?
      puts "  #{C::DIM}Sin evidencia de tipo (ni en la partida ni en los scripts).#{C::RESET}"
      return
    end
    total = res.candidates.sum(&:score)
    res.candidates.first(limit).each_with_index do |c, i|
      pct = (100.0 * c.score / total).round
      head = i.zero? ? "Tipo inferido: #{C::BOLD}#{c.type}#{C::RESET} #{conf_color(res.confidence)}[confianza #{res.confidence}]#{C::RESET}" : "Alternativa  : #{c.type}"
      puts "  #{head} #{C::DIM}(#{pct}%)#{C::RESET}"
      c.evidence.first(evidence_lines).each { |e| puts "      #{C::DIM}+ #{e}#{C::RESET}" }
      puts "      #{C::DIM}+ ... #{c.evidence.size - evidence_lines} evidencia(s) mas#{C::RESET}" if c.evidence.size > evidence_lines
    end
  end
end

# ──────────────────────────────────────────────────────────────────────────────
# ACCIONES
# ──────────────────────────────────────────────────────────────────────────────
def describe_root(v)
  case v
  when RxMarshal::RxHash
    keys = v.pairs.first(6).map { |k, _| k.is_a?(RxMarshal::RxSym) ? ":#{k.name}" : RxMarshal.type_desc(k) }
    "hash con #{v.pairs.size} clave(s): #{keys.join(', ')}#{v.pairs.size > 6 ? ', ...' : ''}"
  when RxMarshal::RxArr then "array con #{v.items.size} elemento(s)"
  when nil, true, false, Integer, RxMarshal::RxSym, RxMarshal::RxStr, RxMarshal::RxFloat, RxMarshal::RxBig
    "#{RxMarshal.type_desc(v)} = #{UI.display_value(v, 40)}"
  else RxMarshal.type_desc(v)
  end
end

def show_info(field, oracle, collector)
  v = field.get
  puts
  puts "#{C::BOLD}Campo:#{C::RESET} #{C::CYAN}#{field.path}#{C::RESET}"
  puts "  Valor : #{UI.display_value(v, 200)}"
  puts "  Tipo  : #{RxMarshal.type_desc(v)}"
  puts "  #{C::DIM}Ranura: #{field.keys.join('  |  ')}#{C::RESET}"
  res = oracle.infer(field)
  UI.show_inference(res, 6, 6)
  objs = res.candidates.map(&:type).select { |t| t.start_with?('obj:') }
  objs.each do |t|
    n = collector.instances.fetch(t.sub('obj:', ''), []).size
    puts "  #{C::DIM}Plantillas de #{t.sub('obj:', '')} en la partida: #{n}#{n >= 12 ? '+' : ''}#{C::RESET}"
  end
end

def clone_from_template(res, collector, forced_cls)
  classes = if forced_cls && !forced_cls.empty?
              [forced_cls]
            else
              res.candidates.map(&:type).select { |t| t.start_with?('obj:') }.map { |t| t.sub('obj:', '') }
            end
  cls = classes.find { |c| !collector.instances.fetch(c, []).empty? }
  unless cls
    wanted = classes.empty? ? 'ningun objeto' : classes.join(', ')
    puts "#{C::RED}No hay instancias de #{wanted} en la partida para usar como plantilla.#{C::RESET}"
    puts "#{C::DIM}Usa 'copiar <Clase>' con una clase que exista en el archivo.#{C::RESET}"
    return nil
  end
  list = collector.instances[cls]
  puts "  Plantillas de #{C::BOLD}#{cls}#{C::RESET}:"
  list.first(8).each_with_index { |(_, path), i| puts "    #{C::YELLOW}#{i + 1}#{C::RESET}) #{C::DIM}#{path}#{C::RESET}" }
  ans = UI.ask("Copiar cual? (1-#{[list.size, 8].min}, Enter = 1): ")
  return nil if ans.nil? || ans.downcase == 'cancelar'
  i = ans.empty? ? 0 : ans.to_i - 1
  unless i >= 0 && i < [list.size, 8].min
    puts "#{C::RED}Opcion invalida.#{C::RESET}"
    return nil
  end
  RxMarshal.deep_clone(list[i][0])
end

# Devuelve [nuevo_valor, reconstruir?] o nil si no hubo cambio
def edit_field(field, doc, oracle, collector)
  old = field.get
  cur_t = RxMarshal.type_desc(old)
  res = oracle.infer(field)
  puts
  puts "#{C::BOLD}Editando:#{C::RESET} #{C::CYAN}#{field.path}#{C::RESET}"
  puts "  Valor : #{UI.display_value(old, 200)}"
  if old.nil?
    UI.show_inference(res)
  else
    puts "  Tipo  : #{cur_t}"
  end
  puts "  #{C::DIM}Prefijos para forzar tipo: int: float: str: sym: bool: | nil | [] | {} | copiar [Clase]#{C::RESET}"
  puts "  #{C::DIM}(Enter = sin cambios | 'cancelar' = abortar)#{C::RESET}"
  raw = UI.ask('Nuevo valor: ')
  if raw.nil? || raw.empty?
    puts "#{C::DIM}Sin cambios.#{C::RESET}"
    return nil
  end
  if raw.downcase == 'cancelar'
    puts "#{C::DIM}Cancelado.#{C::RESET}"
    return nil
  end

  if raw == '[]'
    return [RxMarshal::RxArr.new([]), true]
  elsif raw == '{}'
    return [RxMarshal::RxHash.new([]), true]
  elsif raw =~ /\A(copiar|clonar|plantilla)(?:\s+(\S+))?\z/i
    node = clone_from_template(res, collector, Regexp.last_match(2))
    return node ? [node, true] : nil
  end

  explicit = false
  if raw =~ /\A([a-zA-Z]+):(.*)\z/m && UI::TYPE_ALIASES.key?(Regexp.last_match(1).downcase)
    type = UI::TYPE_ALIASES[Regexp.last_match(1).downcase]
    text = Regexp.last_match(2).strip
    explicit = true
  elsif raw.downcase == 'nil'
    type = 'nil'
    text = raw
    explicit = true
  elsif !old.nil?
    type = cur_t
    text = raw
    unless UI::EDITABLE.include?(type)
      puts "#{C::RED}Este campo no es editable como texto.#{C::RESET}"
      return nil
    end
  elsif res.best && UI::EDITABLE.include?(res.best.type)
    type = res.best.type
    text = raw
  elsif res.best
    puts "#{C::RED}El tipo inferido es #{res.best.type}: usa 'copiar' (objeto), '[]' o '{}',#{C::RESET}"
    puts "#{C::RED}o fuerza otro tipo con prefijo (ej. int:5, str:hola).#{C::RESET}"
    return nil
  else
    type = UI.guess_input_type(raw)
    text = raw
    puts "#{C::DIM}Sin evidencia de tipo; se interpreta como #{type} por lo que escribiste.#{C::RESET}"
  end

  begin
    value = UI.parse_as(type, text)
  rescue RuntimeError => e
    puts "#{C::RED}Error: #{e.message}#{C::RESET}"
    return nil
  end

  if old.nil? && type != 'nil' && res.best && res.best.type != type && res.confidence == :alta
    return nil unless UI.yes?("El tipo inferido es #{res.best.type} (confianza alta). Guardar como #{type} igual? (s/N): ")
  elsif !old.nil? && explicit && type != 'nil' && type != cur_t
    return nil unless UI.yes?("Cambiar el tipo de #{cur_t} a #{type}? (s/N): ")
  end

  begin
    new_val = UI.build_value(doc, type, value, old)
  rescue EncodingError => e
    puts "#{C::RED}No se puede codificar ese texto: #{e.message}#{C::RESET}"
    return nil
  end
  if UI.same_value?(new_val, old)
    puts "#{C::DIM}Mismo valor.#{C::RESET}"
    return nil
  end
  [new_val, false]
end

def save_document(doc, output_path, backup)
  tmp = nil
  bytes = doc.to_file_bytes
  check = RxDocument.parse(bytes)
  raise 'la verificacion del archivo generado fallo' unless check.roots.size == doc.roots.size
  bak = nil
  if backup && File.exist?(output_path)
    bak = "#{output_path}.#{Time.now.strftime('%Y%m%d-%H%M%S')}.bak"
    FileUtils.cp(output_path, bak)
  end
  tmp = "#{output_path}.tmp-#{Process.pid}"
  File.binwrite(tmp, bytes)
  File.rename(tmp, output_path)
  tmp = nil
  [bytes.bytesize, bak]
ensure
  File.delete(tmp) if tmp && File.exist?(tmp)
end

def nil_report(collector, oracle)
  groups = collector.nil_fields.group_by { |f| f.keys.last }
  UI.title("Campos nil agrupados por ranura (#{groups.size} ranuras)")
  counts = Hash.new(0)
  groups.sort_by { |k, _| k }.each do |key, fs|
    res = oracle.infer(fs.first)
    best = res.best
    counts[res.confidence || :sin] += fs.size
    tipo = best ? best.type.sub('obj:', 'obj:') : '?'
    conf = res.confidence ? res.confidence.to_s : '-'
    ev = best ? best.evidence.first.to_s : 'sin evidencia'
    puts format('  %-46s %6d  %s%-24s%s %-5s %s',
                key.length > 46 ? "...#{key[-43..-1]}" : key, fs.size,
                UI.conf_color(res.confidence), tipo, C::RESET, conf, "#{C::DIM}#{ev[0, 90]}#{C::RESET}")
  end
  puts
  puts "  Campos nil: alta #{C::GREEN}#{counts[:alta]}#{C::RESET} | media #{C::YELLOW}#{counts[:media]}#{C::RESET} | " \
       "baja #{C::RED}#{counts[:baja]}#{C::RESET} | sin tipo #{C::DIM}#{counts[:sin]}#{C::RESET}"
end

# ──────────────────────────────────────────────────────────────────────────────
# PROGRAMA PRINCIPAL
# ──────────────────────────────────────────────────────────────────────────────
def main
  options = { color: true, output: nil, scripts: [], autodetect: true, check: false,
              report: false, backup: true, page_size: 20 }
  parser = OptionParser.new do |opts|
    opts.banner = 'Uso: ruby edit_rxdata.rb <archivo.rxdata> [opciones]'
    opts.on('--no-color', 'Sin colores ANSI') { options[:color] = false }
    opts.on('--output FILE', 'Archivo de salida') { |f| options[:output] = f }
    opts.on('--scripts RUTA', 'Scripts del juego para inferir tipos (repetible): carpeta',
            'del juego, Data/Scripts.rxdata, PluginScripts.rxdata, .rb o carpeta de .rb') { |p| options[:scripts] << p }
    opts.on('--no-scripts', 'No buscar scripts del juego automaticamente') { options[:autodetect] = false }
    opts.on('--nil-report', 'Mostrar los campos nil con su tipo inferido y salir') { options[:report] = true }
    opts.on('--check', 'Solo verificar la reconstruccion byte a byte y salir') { options[:check] = true }
    opts.on('--no-backup', 'No crear copia .bak al guardar') { options[:backup] = false }
    opts.on('--page-size N', Integer, 'Campos por pagina (20)') { |n| options[:page_size] = [n, 1].max }
    opts.on('-h', '--help', 'Mostrar esta ayuda') { puts opts; exit }
  end
  begin
    parser.parse!
  rescue OptionParser::ParseError => e
    puts "Error: #{e.message}"
    puts parser
    exit 1
  end
  C.disable! unless options[:color] && ENV['NO_COLOR'].to_s.empty?
  $stdout.sync = true

  file_path = ARGV[0]
  unless file_path
    puts "#{C::RED}Error: debes indicar un archivo .rxdata#{C::RESET}"
    puts parser
    exit 1
  end
  unless File.file?(file_path)
    puts "#{C::RED}Error: no se encontro '#{file_path}'#{C::RESET}"
    exit 1
  end
  output_path = options[:output] || file_path

  puts "#{C::BOLD}#{C::CYAN}══════════════════════════════════════════════════════════#{C::RESET}"
  puts "#{C::BOLD}  Editor de Save File .rxdata#{C::RESET}"
  puts "#{C::BOLD}#{C::CYAN}══════════════════════════════════════════════════════════#{C::RESET}"
  puts "  Archivo : #{C::YELLOW}#{file_path}#{C::RESET}"
  puts "  Salida  : #{C::YELLOW}#{output_path}#{C::RESET}"
  puts

  print "#{C::YELLOW}Cargando archivo...#{C::RESET}"
  begin
    doc = RxDocument.parse(File.binread(file_path))
  rescue RxMarshal::FormatError => e
    puts "\n#{C::RED}Formato no valido: #{e.message}#{C::RESET}"
    exit 1
  end
  extra = doc.wrapper == :zlib ? ', comprimido con zlib' : ''
  puts " #{C::GREEN}OK#{C::RESET} (#{doc.roots.size} objeto(s) Marshal#{extra})"
  doc.warnings.each { |w| puts "  #{C::YELLOW}! #{w}#{C::RESET}" }

  diff = doc.roundtrip_diff
  if diff.nil?
    puts "  #{C::GREEN}Verificacion: el archivo se reconstruye identico byte a byte#{C::RESET}"
  else
    puts "  #{C::RED}ATENCION: la reconstruccion difiere del original desde el byte #{diff}.#{C::RESET}"
    puts "  #{C::RED}Los datos se conservan, pero la codificacion no es identica.#{C::RESET}"
  end
  if options[:check]
    exit(diff.nil? ? 0 : 2)
  end

  puts
  limit = 20
  doc.roots.first(limit).each_with_index do |r, i|
    puts "  #{C::DIM}$#{i}#{C::RESET}  #{describe_root(r)}"
  end
  puts "  #{C::DIM}... y #{doc.roots.size - limit} mas#{C::RESET}" if doc.roots.size > limit

  scripts = nil
  script_paths = options[:scripts].dup
  if script_paths.empty? && options[:autodetect]
    root = ScriptIndex.autodetect(file_path)
    script_paths << root if root
  end
  puts
  if script_paths.empty?
    puts "  #{C::DIM}Sin scripts del juego: se infieren tipos solo con la partida.#{C::RESET}"
    puts "  #{C::DIM}Para afinar la inferencia usa --scripts <carpeta del juego>.#{C::RESET}"
  else
    print "#{C::YELLOW}Analizando scripts del juego...#{C::RESET}"
    scripts = ScriptIndex.new
    script_paths.each { |p| scripts.add_path(p) }
    simple = scripts.fallback_files > 0 ? ", #{scripts.fallback_files} con analisis simple" : ''
    puts " #{C::GREEN}OK#{C::RESET} (#{scripts.files} script(s), #{scripts.hint_total} pistas de tipo#{simple})"
    scripts.roots_used.each { |r| puts "  #{C::DIM}Juego: #{r}#{C::RESET}" }
    scripts.errors.first(5).each { |e| puts "  #{C::YELLOW}! #{e}#{C::RESET}" }
    puts "  #{C::YELLOW}! Ruby sin Ripper: se usa un analisis simple.#{C::RESET}" unless defined?(Ripper)
  end

  collector = Collector.new(doc).run
  oracle = TypeOracle.new(collector, scripts)
  nil_count = collector.fields.count { |f| f.get.nil? }
  puts
  UI.title('Recolectando campos editables...')
  puts "  #{C::GREEN}#{collector.fields.size}#{C::RESET} campos (#{C::YELLOW}#{nil_count}#{C::RESET} nil con tipo a inferir)"

  if options[:report]
    puts
    nil_report(collector, oracle)
    exit 0
  end

  changed = {}
  page_size = options[:page_size]
  current_page = 0
  filter_query = ''
  type_filter = nil

  loop do
    fields = collector.fields
    filtered = fields
    unless filter_query.empty?
      q = filter_query.downcase
      filtered = filtered.select { |f| f.path.downcase.include?(q) }
    end
    filtered = filtered.select { |f| UI.type_match?(f, type_filter, oracle) } if type_filter
    total = filtered.length
    total_pages = [(total / page_size.to_f).ceil, 1].max
    current_page = [[current_page, 0].max, total_pages - 1].min
    page_start = current_page * page_size
    page_fields = filtered[page_start, page_size] || []

    puts
    puts "#{C::BOLD}#{C::CYAN}══ Campos editables ═══════════════════════════════════════#{C::RESET}"
    filtros = []
    filtros << "ruta #{C::MAGENTA}\"#{filter_query}\"#{C::RESET}" unless filter_query.empty?
    filtros << "tipo #{C::MAGENTA}#{type_filter}#{C::RESET}" if type_filter
    head = filtros.empty? ? 'Total' : "Filtro #{filtros.join(' + ')}"
    puts "  #{head}: #{C::YELLOW}#{total}#{C::RESET} | Pag #{C::CYAN}#{current_page + 1}#{C::RESET}/#{total_pages} | Pendientes: #{C::YELLOW}#{changed.size}#{C::RESET}"
    puts

    if page_fields.empty?
      puts "  #{C::DIM}(sin resultados)#{C::RESET}"
    else
      page_fields.each_with_index do |f, i|
        abs = page_start + i + 1
        mark = changed.key?(f.path) ? "#{C::YELLOW}*#{C::RESET}" : ' '
        val = f.get
        res = val.nil? ? oracle.infer(f) : nil
        tag, tag_color = UI.tag_for(val, res)
        path = f.path.length > 52 ? "...#{f.path[-49..-1]}" : f.path
        shown = val.nil? ? "#{UI.display_value(val)} #{UI.nil_hint(res)}" : UI.display_value(val)
        puts format('  %s%s%4d%s  %s%-52s%s %s%-11s%s %s',
                    mark, C::BOLD, abs, C::RESET, C::DIM, path, C::RESET, tag_color, tag, C::RESET, shown)
      end
    end

    puts
    puts "#{C::BOLD}#{C::CYAN}── Comandos ────────────────────────────────────────────────#{C::RESET}"
    puts "  #{C::YELLOW}<num>#{C::RESET}      Editar campo        #{C::YELLOW}i <num>#{C::RESET}   Ver tipo inferido y evidencia"
    puts "  #{C::YELLOW}f <texto>#{C::RESET}  Filtrar por ruta    #{C::YELLOW}t <tipo>#{C::RESET}  Filtrar tipo (nil, nil:str, nil:?, int, sym...)"
    puts "  #{C::YELLOW}f / t#{C::RESET}      Quitar filtros      #{C::YELLOW}n / p#{C::RESET}     Pagina sig/ant   #{C::YELLOW}pag <n>#{C::RESET}  Ir a pagina"
    puts "  #{C::YELLOW}cambios#{C::RESET}    Ver pendientes      #{C::YELLOW}guardar#{C::RESET}   Guardar y salir  #{C::YELLOW}salir#{C::RESET}    Salir sin guardar"
    puts
    print "#{C::BOLD}> #{C::RESET}"

    input = UI.read_line
    if input.nil?
      puts
      puts "#{C::DIM}Entrada cerrada: saliendo sin guardar.#{C::RESET}"
      exit(changed.empty? ? 0 : 1)
    end
    cmd = input.downcase

    if cmd == 'salir'
      if changed.any?
        next unless UI.yes?("#{changed.size} cambio(s) sin guardar. Salir? (s/N): ")
      end
      puts "#{C::DIM}Saliendo.#{C::RESET}"
      exit 0

    elsif cmd == 'guardar'
      if changed.empty?
        puts "#{C::DIM}No hay cambios.#{C::RESET}"
        next
      end
      if diff
        puts "#{C::RED}Recuerda: este archivo no se reconstruia identico byte a byte.#{C::RESET}"
      end
      unless UI.yes?("Guardar #{changed.size} cambio(s) en '#{output_path}'? (s/N): ")
        puts "#{C::DIM}Cancelado.#{C::RESET}"
        next
      end
      begin
        size, bak = save_document(doc, output_path, options[:backup])
        puts "#{C::GREEN}#{C::BOLD}Guardado: #{output_path} (#{size} bytes)#{C::RESET}"
        puts "#{C::DIM}Copia de seguridad: #{bak}#{C::RESET}" if bak
        changed.each do |path, info|
          puts "  #{C::DIM}#{path}#{C::RESET}"
          puts "    #{C::RED}<= #{C::RESET}#{UI.display_value(info[:old])}"
          puts "    #{C::GREEN}=> #{C::RESET}#{UI.display_value(info[:new])}"
        end
        exit 0
      rescue StandardError => e
        puts "#{C::RED}Error al guardar: #{e.message}#{C::RESET}"
        puts C::DIM + (e.backtrace || []).first(3).join("\n") + C::RESET
      end

    elsif cmd == 'cambios'
      puts
      if changed.empty?
        puts "  #{C::DIM}Sin cambios pendientes.#{C::RESET}"
      else
        puts "#{C::BOLD}Cambios pendientes (#{changed.size}):#{C::RESET}"
        changed.each do |path, info|
          puts "  #{C::DIM}#{path}#{C::RESET}"
          puts "    #{C::RED}<= #{C::RESET}#{UI.display_value(info[:old])}"
          puts "    #{C::GREEN}=> #{C::RESET}#{UI.display_value(info[:new])}"
        end
      end

    elsif cmd == 'n' then current_page += 1
    elsif cmd == 'p' then current_page -= 1
    elsif cmd =~ /\Apag\s+(\d+)\z/ then current_page = Regexp.last_match(1).to_i - 1

    elsif cmd == 'f' || cmd.start_with?('f ')
      filter_query = input[1..-1].strip
      current_page = 0

    elsif cmd == 't' || cmd.start_with?('t ')
      q = cmd[1..-1].strip
      type_filter = q.empty? ? nil : q
      current_page = 0

    elsif cmd =~ /\Ai\s+(\d+)\z/
      field = filtered[Regexp.last_match(1).to_i - 1]
      if field
        show_info(field, oracle, collector)
      else
        puts "#{C::RED}Numero fuera de rango (1-#{total}).#{C::RESET}"
      end

    elsif cmd =~ /\A\d+\z/
      field = filtered[cmd.to_i - 1]
      unless field
        puts "#{C::RED}Numero fuera de rango (1-#{total}).#{C::RESET}"
        next
      end
      old_val = field.get
      result = edit_field(field, doc, oracle, collector)
      next unless result
      new_val, rebuild = result
      field.set(new_val)
      if changed.key?(field.path)
        changed[field.path][:new] = new_val
        changed.delete(field.path) if UI.same_value?(changed[field.path][:old], new_val)
      else
        changed[field.path] = { old: old_val, new: new_val }
      end
      puts "#{C::GREEN}Actualizado:#{C::RESET} #{UI.display_value(old_val)} => #{UI.display_value(new_val)}"
      if rebuild
        collector = Collector.new(doc).run
        oracle.reset!(collector)
        puts "#{C::DIM}Estructura nueva: #{collector.fields.size} campos editables ahora.#{C::RESET}"
      end

    else
      puts "#{C::DIM}Comando no reconocido.#{C::RESET}"
    end
  end
end

main if $PROGRAM_NAME == __FILE__
