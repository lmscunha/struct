using json = nlohmann::json;

using arg_container = std::vector<json>;
using function_pointer = json(*)(arg_container&&);

// NOTE: Standard Library for now
template<class T_K, class T_V>
using hash_table = std::unordered_map<T_K, T_V>;

class Utility {
  private:
    hash_table<std::string, function_pointer> table;

  public:
    Utility() = default;

    void set_key(const std::string&, function_pointer);

    function_pointer& get_key(const std::string&);

    function_pointer& operator[](const std::string&);

    ~Utility() = default;

};

class Provider {

  public:

    // NOTE: More dynamic approach compared to function overloading
    Provider(const json&);

    static Provider test(const json&);
    static Provider test(void);

    hash_table<std::string, Utility> utility(void);
};
