# Ballerina Code Expansion

**Query:** Update the pagination logic so it validates 'page' and 'limit' values, returning a 400 Bad Request if they are less than or equal to zero.

---

Based on the user query and the provided code chunks, I'll expand and organize the relevant Ballerina code to address the pagination logic update. Here's the expanded and organized code:

## main.bal

## Imports
```ballerina
import ballerina/http;
```

## Configuration Variables
```ballerina
configurable int maxBooksPerPage = 10;
```

## Module Level Variables
```ballerina
int totalRequests = 0;
map<Book> bookStore = {};
```

## Services
```ballerina
service /bookstore on new http:Listener(servicePort) {
    // Other resources...
}
```

## Resources
```ballerina
resource function get books(int page = 1, int 'limit = maxBooksPerPage) returns PaginatedBooks|http:BadRequest|http:InternalServerError {
    totalRequests += 1;

    // Validate page and limit values
    if (page <= 0 || 'limit <= 0) {
        return http:BAD_REQUEST;
    }

    Book[] allBooks = bookStore.toArray();
    int totalCount = allBooks.length();
    int startIndex = (page - 1) * 'limit;
    int endIndex = startIndex + 'limit;

    if startIndex >= totalCount {
        PaginatedBooks emptyResult = {
            books: [],
            totalCount: totalCount,
            currentPage: page,
            totalPages: (totalCount + 'limit - 1) / 'limit
        };
        return emptyResult;
    }

    if endIndex > totalCount {
        endIndex = totalCount;
    }

    Book[] paginatedBooks = [];
    int index = startIndex;
    while index < endIndex {
        paginatedBooks.push(allBooks[index]);
        index += 1;
    }

    PaginatedBooks result = {
        books: paginatedBooks,
        totalCount: totalCount,
        currentPage: page,
        totalPages: (totalCount + 'limit - 1) / 'limit
    };

    return result;
}
```

## types.bal

```ballerina
// Book record type
public type Book record {|
    string id;
    string title;
    string author;
    string isbn;
    decimal price;
    int quantity;
|};

// Pagination response type
public type PaginatedBooks record {|
    Book[] books;
    int totalCount;
    int currentPage;
    int totalPages;
|};
```

This expanded and organized code addresses the user's query by adding validation for the `page` and `limit` parameters in the `get books` resource function. The function now returns an `http:BadRequest` if either `page` or `limit` is less than or equal to zero. The rest of the pagination logic remains unchanged.

The code includes the necessary imports, configuration variables, module-level variables, and type definitions to provide context for the pagination functionality. The `PaginatedBooks` record type is also included to show the structure of the returned data.

---

*Code expansion generated from 8 relevant chunks across 2 files*
