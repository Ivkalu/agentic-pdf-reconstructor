Your job will be to create an agentic pdf reconstructor using ChatAnthropic provider

There will be 2 agents:
1. PDF RECONSTRUCTOR AGENT
2. PDF ANALYZER AGENT

Pdf reconstructor agent will take the input image and try to accuratelly reconstruct the document in the image by using latex, it will have following tools:
1. write latex (writes in a temporary latex file) (note: make this tool definition simmilar to how claude code has it)
2. read latex (reads that temporary latex file) (note: make this tool definition simmilar to how claude code has it, with offset and limit arguments)
3. compile pdf (it will compile that latex file)
4. verify pdf tool (this will call a PDF ANALYZER AGENT with sufficient context, and wait for his output)
5. done tool (this tool is called once agent is finished analyzing)

Pdf analyzer agent will take as input the compiled version of the latex pdf, and the original image of the document, and his job will be to find and describe the differences between two, in details (with hints to what to focus on, right number of pages, margins, lines, tables, formulas, wrong fonts, wrong colors)

I think pdf analyzer doesn't need tools, as he has enough info from the context (2 documents and system prompt).
Once analyzer is done, he will return the info of what the reconstructor agent needs to change in the pdf to make it better, or he will tell it that it is fine.

Reconstructor agent then continues to iterate untill analyzer agent tells him that either differences are minor or he is stuck in aloop, or he calls done tool().

If you think either agent needs additional tools, let me know

IMPORTANT NOTES:
1. the program should be written in javascript/typescript
2. use langchain (https://docs.langchain.com/oss/javascript/langgraph/quickstart)
3. put tools in a tools folder, each should be well defined and self documented
4. make dockerfile that will have latex installed, so compile tool can use it. everything should be ran inside docker.
5. make good loggings so i can easily debug once i try the program out!

